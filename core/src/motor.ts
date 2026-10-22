import {Canal, vazio} from './canal'
import {COMPONENTES} from './componentes'
import {encontrarCiclo, variaveisDoEnvelope} from './envelope'
import type {
  AvaliarExpression,
  ConsultarSql,
  ContextoDoComponente,
  Envelope,
  ExecucaoDoComponente,
  ModoDeExecucao,
  NoParaExecutar,
  PoliticaDeErro,
  PrepararScript,
  RegistroDaExecucao,
  WorkflowCurrentRun,
  WorkflowParaExecutar,
} from './tipos'

export const INICIO = 'inicio'
export const FIM = 'fim'

/** Cópia da amostra (o envelope segue adiante e pode ser mudado por outro componente). */
const clonar = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** Quantos envelopes guardar por porta na amostra da execução. */
const TAMANHO_DA_AMOSTRA = 20

export type OpcoesDaExecucao = {
  modo: ModoDeExecucao
  id: string
  /** valores passados pelo gatilho (o que faltar usa o padrão do workflow) */
  valoresDosParametros?: Record<string, string>
  /**
   * Entrada do workflow (ex.: corpo do webhook). Só vale se o Início estiver marcado como "recebe entrada".
   * Objeto vira os campos do DATA; array vira um envelope por item; outro valor vira DATA.input.
   */
  entrada?: unknown
  avaliar: AvaliarExpression
  /** compila e isola scripts (componente TypeScript); sem ele, o componente falha */
  prepararScript?: PrepararScript
  /** roda consultas no SQL Server; sem ele, o componente falha */
  consultarSql?: ConsultarSql
  /** workflows que o Workflow Invoker pode chamar, pelo id */
  workflows?: Record<string, WorkflowParaExecutar>
  /** execução que chamou esta (o Workflow Invoker preenche) */
  parentId?: string
  /** ids dos workflows da chamada até aqui, para pegar chamada circular */
  cadeia?: string[]
  /** cada envelope que chega ao End (o Workflow Invoker usa para passar adiante); o End espera a promessa */
  aoChegarNoFim?: (doc: Envelope) => Promise<void>
  segredos?: Record<string, string>
  /** para cancelar de fora (botão Parar) */
  sinal?: AbortSignal
  /** tempo máximo da execução; passou disso, ela é interrompida */
  tempoMaximoMs?: number
}

class ExecucaoInterrompida extends Error {}

/** Quantos workflows um pode chamar em sequência (A chama B que chama C...). */
export const MAX_PROFUNDIDADE_DE_WORKFLOWS = 10
/** Quantas subexecuções guardar no registro do componente. */
const MAX_SUBEXECUCOES = 50

/**
 * Tempo ativo de um componente: liga quando o código dele volta a rodar (o motor pediu o próximo resultado, chegou um
 * envelope) e desliga quando ele fica esperando (entrada, próximo componente, ctx.esperar). Como a thread é uma só,
 * a soma é praticamente o CPU do componente.
 */
class Relogio {
  total = 0
  private desde?: number

  get rodando() { return this.desde !== undefined }

  retomar() {
    this.desde ??= performance.now()
  }

  parar() {
    if (this.desde === undefined) return
    this.total += performance.now() - this.desde
    this.desde = undefined
  }
}

/** Quantos envelopes medir no começo para estimar o tamanho; depois, um a cada INTERVALO_DA_MEDIDA. */
const MEDIDAS_INICIAIS = 50
const INTERVALO_DA_MEDIDA = 100

/** Pico do que o componente guardou (ctx.guardando). Bytes = pico × tamanho médio do JSON do DATA (amostrado). */
class Memoria {
  pico = 0
  private chamadas = 0
  private medidos = 0
  private bytesMedidos = 0

  guardando(envelopes: number, guardado?: Envelope) {
    this.pico = Math.max(this.pico, envelopes)
    if (!guardado) return
    this.chamadas += 1
    if (this.medidos >= MEDIDAS_INICIAIS && this.chamadas % INTERVALO_DA_MEDIDA !== 0) return
    try {
      this.bytesMedidos += JSON.stringify(guardado.DATA)?.length ?? 0
      this.medidos += 1
    } catch { /* DATA que não vira JSON (ex.: BigInt): fica sem medida */ }
  }

  get resumo(): ExecucaoDoComponente['memoria'] {
    if (this.pico === 0) return undefined
    const media = this.medidos ? this.bytesMedidos / this.medidos : 0
    return {picoDeEnvelopes: this.pico, picoDeBytes: Math.round(this.pico * media)}
  }
}

/** Lê uma fonte ligando o relógio a cada item e desligando enquanto espera o próximo. */
async function* cronometrar<T>(fonte: AsyncIterable<T>, relogio: Relogio): AsyncIterable<T> {
  const it = fonte[Symbol.asyncIterator]()
  try {
    while (true) {
      relogio.parar()
      const r = await it.next()
      if (r.done) return
      relogio.retomar()
      yield r.value
    }
  } finally {
    await it.return?.()
  }
}

const ROTULO_DO_STATUS: Record<RegistroDaExecucao['status'], string> = {
  concluida: 'concluída', 'com-avisos': 'com avisos', 'com-erros': 'com erros', falhou: 'falhou',
}

/**
 * Envelope que sai pela porta de erro: ganha DATA.errors (em inglês, como tudo que circula no envelope).
 * É uma lista: se o mesmo envelope falhar em mais de um componente, os erros se acumulam.
 */
function comErro(doc: Envelope, erro: Error, componente: string): Envelope {
  const anteriores = Array.isArray(doc.DATA.errors) ? doc.DATA.errors : []
  return {...doc, DATA: {...doc.DATA, errors: [...anteriores, {error: erro.name || 'Error', message: erro.message, component: componente}]}}
}

function politica(no: NoParaExecutar): PoliticaDeErro {
  const v = no.config.seErro
  return v === 'continuar' || v === 'desviar' ? v : 'parar'
}

function converter(valor: string, tipo: string): unknown {
  if (tipo === 'numero') return Number(valor)
  if (tipo === 'booleano') return valor === 'true'
  return valor
}

/** Resolve os parâmetros: valor do gatilho, senão o padrão; obrigatório sem valor impede a execução. */
export function resolverParametros(wf: WorkflowParaExecutar, valores: Record<string, string> = {}) {
  const parametros: Record<string, unknown> = {}
  const faltando: string[] = []
  for (const p of wf.parametros) {
    const valor = valores[p.nome] ?? p.padrao
    if (p.obrigatorio && (valor === undefined || valor === '')) faltando.push(p.nome)
    parametros[p.nome] = converter(valor ?? '', p.tipo)
  }
  return {parametros, faltando}
}

/**
 * Ordem do fluxo (Início → ... → Fim), para o registro listar os componentes na ordem em que os envelopes passam.
 * Os componentes rodam ao mesmo tempo, então o horário de início não serve: num fluxo rápido todos começam no mesmo ms.
 * Kahn pelas ligações; empate pela ordem dos nós; o que não está ligado vai para o fim.
 */
export function ordemDoFluxo(wf: WorkflowParaExecutar): string[] {
  const grau = new Map(wf.nos.map(n => [n.id, 0]))
  for (const l of wf.ligacoes) grau.set(l.destino, (grau.get(l.destino) ?? 0) + 1)
  const ligados = new Set(wf.ligacoes.flatMap(l => [l.origem, l.destino]))
  const fila = wf.nos.filter(n => grau.get(n.id) === 0 && (ligados.has(n.id) || n.tipo === INICIO)).map(n => n.id)
  const ordem: string[] = []
  while (fila.length) {
    const atual = fila.shift()!
    ordem.push(atual)
    for (const l of wf.ligacoes.filter(x => x.origem === atual)) {
      const g = (grau.get(l.destino) ?? 0) - 1
      grau.set(l.destino, g)
      if (g === 0) fila.push(l.destino)
    }
  }
  // Fim por último quando ele recebe de vários ramos; ciclos e soltos no final, na ordem dos nós
  const resto = wf.nos.map(n => n.id).filter(id => !ordem.includes(id))
  const semFim = ordem.filter(id => wf.nos.find(n => n.id === id)?.tipo !== FIM)
  const fins = ordem.filter(id => wf.nos.find(n => n.id === id)?.tipo === FIM)
  return [...semFim, ...fins, ...resto]
}

/**
 * Executa o workflow envelope a envelope (seção 7 do plano): cada ligação vira um Canal e todos os
 * componentes rodam ao mesmo tempo. Devolve o registro com início, fim, contagens, logs e amostras por componente.
 */
export async function executarWorkflow(wf: WorkflowParaExecutar, opcoes: OpcoesDaExecucao): Promise<RegistroDaExecucao> {
  const inicio = Date.now()
  const run: WorkflowCurrentRun = {
    id: opcoes.id, mode: opcoes.modo, project: wf.projeto, workflow: wf.workflow, startedAt: new Date(inicio).toISOString(),
    ...(opcoes.parentId ? {parentId: opcoes.parentId} : {}),
  }
  const {parametros, faltando} = resolverParametros(wf, opcoes.valoresDosParametros)

  const registros = new Map<string, ExecucaoDoComponente>(wf.nos.map(no => [no.id, {
    noId: no.id, rotulo: no.rotulo, tipo: no.tipo, status: 'nao-executou',
    entradas: {}, saidas: {}, logs: [], amostraDeEntrada: [], amostraDeSaida: {},
  }]))
  const relogios = new Map(wf.nos.map(no => [no.id, new Relogio()]))
  const memorias = new Map(wf.nos.map(no => [no.id, new Memoria()]))

  const finalizar = (status: RegistroDaExecucao['status'], erro?: string): RegistroDaExecucao => {
    const duracaoMs = Date.now() - inicio
    // fecha o log no End, par do "iniciada" do Start
    const regDoFim = registros.get(wf.nos.find(n => n.tipo === FIM)?.id ?? '')
    regDoFim?.logs.push({
      em: new Date().toISOString(),
      nivel: status === 'falhou' ? 'erro' : status === 'concluida' ? 'info' : 'aviso',
      mensagem: `Execução ${run.id} finalizada (${ROTULO_DO_STATUS[status]}) em ${duracaoMs} ms.`,
    })
    return {run, parametros, status, erro, fim: new Date().toISOString(), duracaoMs, componentes: ordemDoFluxo(wf).map(id => registros.get(id)!)}
  }

  if (faltando.length) return finalizar('falhou', `Parâmetro obrigatório sem valor: ${faltando.join(', ')}.`)

  const ciclo = encontrarCiclo(wf.nos.map(n => n.id), wf.ligacoes)
  if (ciclo) {
    const nome = (id: string) => wf.nos.find(n => n.id === id)?.rotulo ?? id
    return finalizar('falhou', `O fluxo tem um ciclo (loop infinito): ${ciclo.map(nome).join(' → ')}.`)
  }

  const noInicio = wf.nos.find(n => n.tipo === INICIO)
  const inicioRecebeEntrada = noInicio?.config.recebeEntrada === true
  if (opcoes.entrada !== undefined && !inicioRecebeEntrada) {
    return finalizar('falhou', 'O Start deste workflow não recebe entrada. Marque "Recebe entrada" no Start ou chame sem corpo.')
  }
  // array: um envelope por item (envelope a envelope); objeto: os campos viram o DATA; outro valor: DATA.input
  const paraEnvelope = (v: unknown): Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v) ? {...(v as Record<string, unknown>)} : {input: v}
  const envelopesIniciais: Record<string, unknown>[] = opcoes.entrada === undefined ? [{}]
    : Array.isArray(opcoes.entrada) ? opcoes.entrada.map(paraEnvelope)
      : [paraEnvelope(opcoes.entrada)]

  // um canal por ligação
  const canais = wf.ligacoes.map(l => ({...l, canal: new Canal<Envelope>()}))
  /** Fontes de cada entrada do nó. Várias ligações na mesma entrada (ex.: End) viram uma só, na ordem de chegada. */
  const entradasDo = (noId: string) => {
    const porPorta: Record<string, AsyncIterable<Envelope>[]> = {}
    for (const l of canais.filter(c => c.destino === noId)) (porPorta[l.portaDeDestino] ??= []).push(l.canal)
    return Object.fromEntries(Object.entries(porPorta).map(([porta, fontes]) => [porta, fontes.length === 1 ? fontes[0] : juntar(fontes)]))
  }
  const saidasDo = (noId: string, porta: string) => canais.filter(c => c.origem === noId && c.portaDeOrigem === porta).map(c => c.canal)
  /** avisa quem fala com fora (ex.: consulta no banco) que a execução parou */
  const controle = new AbortController()
  const abortarTudo = () => {
    canais.forEach(c => c.canal.abortar())
    controle.abort()
  }

  let falha: string | undefined

  /** envelopes que saíram por uma porta sem ligação (somem do fluxo): por nó e porta */
  const descartados = new Map<string, Record<string, number>>()

  async function enviar(no: NoParaExecutar, porta: string, doc: Envelope) {
    const reg = registros.get(no.id)!
    // esperar o próximo componente (fila cheia) não é tempo ativo
    const relogio = relogios.get(no.id)!
    const estavaRodando = relogio.rodando
    relogio.parar()
    reg.saidas[porta] = (reg.saidas[porta] ?? 0) + 1
    if (saidasDo(no.id, porta).length === 0) {
      const porPorta = descartados.get(no.id) ?? {}
      porPorta[porta] = (porPorta[porta] ?? 0) + 1
      descartados.set(no.id, porPorta)
    }
    const amostra = (reg.amostraDeSaida[porta] ??= [])
    if (amostra.length < TAMANHO_DA_AMOSTRA) amostra.push(clonar(doc.DATA))
    for (const canal of saidasDo(no.id, porta)) await canal.enviar(doc)
    if (estavaRodando) relogio.retomar()
  }

  /**
   * Conta e guarda amostra do que entra, e marca o início no primeiro envelope. O relógio do componente para enquanto
   * ele espera o próximo envelope e volta quando o envelope é entregue.
   */
  async function* observarEntrada(no: NoParaExecutar, porta: string, fonte: AsyncIterable<Envelope>) {
    const reg = registros.get(no.id)!
    const relogio = relogios.get(no.id)!
    relogio.parar()
    for await (const doc of fonte) {
      reg.inicio ??= new Date().toISOString()
      reg.entradas[porta] = (reg.entradas[porta] ?? 0) + 1
      if (reg.amostraDeEntrada.length < TAMANHO_DA_AMOSTRA) reg.amostraDeEntrada.push(clonar(doc.DATA))
      relogio.retomar()
      yield doc
      relogio.parar()
    }
  }

  async function rodar(no: NoParaExecutar) {
    const reg = registros.get(no.id)!
    const log = (nivel: 'info' | 'aviso' | 'erro', mensagem: string) => reg.logs.push({em: new Date().toISOString(), nivel, mensagem})
    const portasDeSaida = [...new Set(canais.filter(c => c.origem === no.id).map(c => c.portaDeOrigem))]
    const relogio = relogios.get(no.id)!
    const t0 = Date.now()
    let erros = 0
    try {
      const entradas = Object.fromEntries(Object.entries(entradasDo(no.id)).map(([porta, fonte]) => [porta, observarEntrada(no, porta, fonte)]))

      if (no.tipo === INICIO) {
        reg.inicio = new Date().toISOString()
        relogio.retomar()
        for (const envelope of envelopesIniciais) {
          if (opcoes.entrada !== undefined) {
            reg.entradas['in-0'] = (reg.entradas['in-0'] ?? 0) + 1
            if (reg.amostraDeEntrada.length < TAMANHO_DA_AMOSTRA) reg.amostraDeEntrada.push(clonar(envelope))
          }
          const doc: Envelope = {WORKFLOW_CURRENT_RUN: run, PARAMETERS: parametros, DATA: envelope}
          for (const porta of portasDeSaida) await enviar(no, porta, doc)
        }
        log('info', `Execução ${run.id} iniciada (${run.mode})${opcoes.entrada !== undefined ? ' com entrada' : ''}.`)
      } else if (no.tipo === FIM) {
        for (const fonte of Object.values(entradas)) {
          for await (const doc of fonte) if (opcoes.aoChegarNoFim) await opcoes.aoChegarNoFim(doc)
        }
      } else if (no.desativado) {
        log('aviso', 'Desativado (bypass): não executou, os envelopes passaram direto.')
        for await (const doc of entradas['in-0'] ?? vazio<Envelope>()) await enviar(no, 'out-0', doc)
      } else {
        const logica = COMPONENTES[no.tipo]
        if (!logica) throw new Error(`Componente "${no.tipo}" não existe no runner.`)
        const ctx: ContextoDoComponente = {
          run, no, log,
          prepararScript: async codigo => {
            if (!opcoes.prepararScript) throw new Error('Este runner não executa scripts.')
            return opcoes.prepararScript(codigo, {run, parametros, segredos: opcoes.segredos ?? {}, log: m => log('info', m)})
          },
          valorDoCampo: (campo, doc) => (campo.expression
            ? opcoes.avaliar(campo.valor, variaveisDoEnvelope(doc, opcoes.segredos))
            : campo.valor),
          esperar: async promessa => {
            relogio.parar()
            try {
              return await promessa
            } finally {
              relogio.retomar()
            }
          },
          esperarCada: fonte => cronometrar(fonte, relogio),
          invocarWorkflow: (workflowId, {parametros: valores, entrada}) => {
            const filho = opcoes.workflows?.[workflowId]
            if (!filho) throw new Error(`O workflow chamado (${workflowId}) não foi encontrado.`)
            const cadeia = [...(opcoes.cadeia ?? [wf.id ?? wf.workflow]), workflowId]
            if (cadeia.slice(0, -1).includes(workflowId)) {
              const nome = (id: string) => opcoes.workflows?.[id]?.workflow ?? (id === wf.id ? wf.workflow : id)
              throw new Error(`Chamada circular de workflows: ${cadeia.map(nome).join(' → ')}.`)
            }
            if (cadeia.length > MAX_PROFUNDIDADE_DE_WORKFLOWS + 1) {
              throw new Error(`Passou de ${MAX_PROFUNDIDADE_DE_WORKFLOWS} workflows chamados em sequência.`)
            }
            // o filho para quando esta execução para, ou quando quem chamou desiste de ler
            const controleDoFilho = new AbortController()
            const cancelar = () => controleDoFilho.abort()
            controle.signal.addEventListener('abort', cancelar)
            const fila = new Canal<Record<string, unknown>>()
            const resultado = executarWorkflow(filho, {
              ...opcoes,
              id: crypto.randomUUID(),
              valoresDosParametros: valores,
              entrada,
              sinal: controleDoFilho.signal,
              // o tempo máximo é o desta execução (que cancela o filho junto)
              tempoMaximoMs: undefined,
              parentId: run.id,
              cadeia,
              aoChegarNoFim: doc => fila.enviar(doc.DATA),
            }).then(registro => {
              const lista = (reg.subexecucoes ??= [])
              if (lista.length < MAX_SUBEXECUCOES) {
                lista.push({id: registro.run.id, workflow: registro.run.workflow, status: registro.status, duracaoMs: registro.duracaoMs, ...(registro.erro ? {erro: registro.erro} : {})})
              }
              return registro
            }).finally(() => {
              controle.signal.removeEventListener('abort', cancelar)
              fila.fechar()
            })
            return {
              envelopes: fila,
              resultado,
              cancelar: () => {
                cancelar()
                fila.abortar()
              },
            }
          },
          consultarSql: ({segredo, ...consulta}) => {
            if (!opcoes.consultarSql) throw new Error('Este runner não consulta bancos.')
            const conexao = opcoes.segredos?.[segredo]
            if (!conexao) throw new Error(`O segredo "${segredo}" não existe neste runner.`)
            return opcoes.consultarSql({...consulta, conexao, sinal: controle.signal})
          },
          guardando: (envelopes, guardado) => memorias.get(no.id)!.guardando(envelopes, guardado),
        }
        // o relógio roda enquanto o componente produz o próximo resultado (a espera pelas entradas ele desconta)
        for await (const saida of cronometrarPedidos(logica.executar(entradas, no.config, ctx), relogio)) {
          if ('porta' in saida) {
            await enviar(no, saida.porta, saida.doc)
            continue
          }
          const p = politica(no)
          // Desviar = erro tratado: o envelope segue pela porta de erro e o componente não conta como "com erros"
          if (p === 'desviar') {
            log('aviso', `Desviado para a porta de erro: ${saida.erro.message}`)
            await enviar(no, 'erro', comErro(saida.doc, saida.erro, no.rotulo))
            continue
          }
          erros += 1
          log('erro', saida.erro.message)
          if (p === 'parar') throw new ExecucaoInterrompida(`"${no.rotulo}": ${saida.erro.message}`)
          // continuar: o envelope que entrou sai como estava pela saída principal e o fluxo segue
          if (p === 'continuar') await enviar(no, 'out-0', saida.doc)
        }
      }
      // saída opcional sem ligação (ex.: false do Filter): descartar é o esperado, não vira aviso
      const definidas = COMPONENTES[no.tipo]?.saidasOpcionais ?? []
      const opcionais = typeof definidas === 'function' ? definidas(no.config) : definidas
      for (const porta of opcionais) {
        const n = descartados.get(no.id)?.[porta]
        if (!n) continue
        log('info', `${n} envelope(s) descartado(s) pela saída ${porta}, que não está ligada.`)
        delete descartados.get(no.id)![porta]
      }
      if (descartados.get(no.id) && Object.keys(descartados.get(no.id)!).length === 0) descartados.delete(no.id)
      const perdidos = descartados.get(no.id)
      if (perdidos) {
        for (const [porta, n] of Object.entries(perdidos)) {
          log('aviso', `${n} envelope(s) descartado(s): a saída ${porta === 'out-0' ? 'principal' : porta} não está ligada.`)
        }
      }
      reg.status = erros > 0 ? 'com-erros' : no.desativado ? 'desativado' : perdidos ? 'com-avisos' : 'concluido'
    } catch (e) {
      reg.status = 'falhou'
      const mensagem = e instanceof Error ? e.message : String(e)
      log('erro', mensagem)
      falha ??= e instanceof ExecucaoInterrompida ? mensagem : `"${no.rotulo}": ${mensagem}`
      abortarTudo()
    } finally {
      relogio.parar()
      reg.tempoAtivoMs = Math.round(relogio.total * 100) / 100
      reg.memoria = memorias.get(no.id)!.resumo
      reg.inicio ??= new Date(t0).toISOString()
      reg.fim = new Date().toISOString()
      reg.duracaoMs = Date.now() - Date.parse(reg.inicio)
      for (const porta of portasDeSaida) for (const canal of saidasDo(no.id, porta)) canal.fechar()
    }
  }

  // parar de fora (botão) ou por tempo: derruba os canais e cada componente termina o que estava fazendo
  const interromper = (motivo: string) => {
    falha ??= motivo
    abortarTudo()
  }
  const aoCancelar = () => interromper('Execução cancelada.')
  if (opcoes.sinal?.aborted) aoCancelar()
  opcoes.sinal?.addEventListener('abort', aoCancelar)
  const limite = opcoes.tempoMaximoMs
    ? setTimeout(() => interromper(`Execução interrompida: passou do tempo máximo (${Math.round(opcoes.tempoMaximoMs! / 1000)} s).`), opcoes.tempoMaximoMs)
    : undefined

  await Promise.all(wf.nos.map(rodar))

  clearTimeout(limite)
  opcoes.sinal?.removeEventListener('abort', aoCancelar)

  if (falha) return finalizar('falhou', falha)
  // nada chegou ao Fim: o fluxo rodou, mas não entregou nada
  const fim = wf.nos.find(n => n.tipo === FIM)
  const regDoFim = fim && registros.get(fim.id)
  if (regDoFim && regDoFim.status === 'concluido' && !regDoFim.entradas['in-0']) {
    regDoFim.status = 'com-avisos'
    regDoFim.logs.push({em: new Date().toISOString(), nivel: 'aviso', mensagem: 'Nenhum envelope chegou ao End.'})
  }

  const status = [...registros.values()].map(r => r.status)
  return finalizar(status.includes('com-erros') ? 'com-erros' : status.includes('com-avisos') ? 'com-avisos' : 'concluida')
}

/** Liga o relógio a cada pedido de próximo resultado e desliga quando o resultado sai. */
async function* cronometrarPedidos<T>(fonte: AsyncIterable<T>, relogio: Relogio): AsyncIterable<T> {
  const it = fonte[Symbol.asyncIterator]()
  try {
    while (true) {
      relogio.retomar()
      const r = await it.next()
      relogio.parar()
      if (r.done) return
      yield r.value
    }
  } finally {
    await it.return?.()
  }
}

/** Junta várias fontes numa só, na ordem em que os envelopes chegam (como o Union). */
async function* juntar(fontes: AsyncIterable<Envelope>[]): AsyncIterable<Envelope> {
  const fila = new Canal<Envelope>()
  const despejos = fontes.map(async fonte => {
    for await (const doc of fonte) await fila.enviar(doc)
  })
  Promise.all(despejos).finally(() => fila.fechar())
  yield* fila
  await Promise.all(despejos)
}
