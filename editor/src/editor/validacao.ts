import type {Edge} from '@xyflow/react'
import {encontrarCiclo, portasCompativeis, problemaNoNome, TIPOS_DE_PORTA} from '@dataflow/core'
import {ehDoFluxo, FIM, INICIO, POR_TIPO} from '@/componentes/catalogo'
import type {NoDoFluxo} from '@/mock/fluxos'
import {PORTA_DE_ERRO, politicaDeErro, qtdEntradas, qtdSaidas, rotuloDaSaida, saidaOpcional, tipoDaPorta, type NoComponente} from './no-componente'

export type Pendencia = {noId: string; mensagem: string}

export function ehComponente(no: NoDoFluxo): no is NoComponente {
  return no.type === 'componente'
}

/** O componente recebe linhas de outro componente (não só do Início). */
export function recebeLinhas(no: NoComponente, nos: NoDoFluxo[], edges: Edge[]) {
  return edges.some(e => e.target === no.id && nos.find(n => n.id === e.source && ehComponente(n) && n.data.tipo !== INICIO))
}

/**
 * Regras da prancheta (as de cada componente vêm do `validar` dele). Só olha a montagem do fluxo:
 * a validação dos dados (linhas dos CSVs) é a simulação da execução, que vem depois.
 */
export function validarFluxo(nos: NoDoFluxo[], edges: Edge[]): Pendencia[] {
  const componentes = nos.filter(ehComponente)
  const porId = new Map(componentes.map(n => [n.id, n]))
  const inicio = componentes.find(n => n.data.tipo === INICIO)
  const fim = componentes.find(n => n.data.tipo === FIM)
  const pendencias: Pendencia[] = []
  const falhar = (no: NoComponente, mensagem: string) => pendencias.push({noId: no.id, mensagem: `"${no.data.rotulo}" ${mensagem}`})

  // ciclo nas ligações = loop infinito de envelopes: o fluxo nem roda
  const ciclo = encontrarCiclo(componentes.map(n => n.id), edges.map(e => ({origem: e.source, destino: e.target})))
  if (ciclo) {
    const primeiro = porId.get(ciclo[0])!
    falhar(primeiro, `faz parte de um ciclo (loop infinito): ${ciclo.map(id => porId.get(id)?.data.rotulo ?? id).join(' → ')}.`)
  }

  // quem chega ao End (andando de trás para frente). Desativado é bypass: repassa o que entra pela in-0 para a
  // out-0, então só essas ligações dele contam
  const passa = (e: Edge) => !(porId.get(e.source)?.data.desativado && e.sourceHandle !== 'out-0')
    && !(porId.get(e.target)?.data.desativado && e.targetHandle !== 'in-0')
  const chegaAoFim = new Set<string>()
  if (fim) {
    chegaAoFim.add(fim.id)
    const fila = [fim.id]
    while (fila.length) {
      const atual = fila.shift()!
      for (const e of edges) {
        if (e.target !== atual || chegaAoFim.has(e.source) || !passa(e)) continue
        chegaAoFim.add(e.source)
        fila.push(e.source)
      }
    }
  }

  if (inicio) {
    for (let i = 0; i < qtdSaidas(inicio.data); i++) {
      if (!edges.some(e => e.source === inicio.id && e.sourceHandle === `out-${i}`)) falhar(inicio, `tem a saída ${i + 1} sem ligação.`)
    }
  }
  if (fim) {
    for (let i = 0; i < qtdEntradas(fim.data); i++) {
      if (!edges.some(e => e.target === fim.id && e.targetHandle === `in-${i}`)) falhar(fim, `tem a entrada ${i + 1} sem ligação.`)
    }
  }

  // ligações entre portas de tipos que não combinam (ex.: fluxo antigo ou tipo que mudou)
  for (const e of edges) {
    const origem = porId.get(e.source)
    const destino = porId.get(e.target)
    if (!origem || !destino) continue
    const saida = tipoDaPorta(origem.data, e.sourceHandle)
    const entrada = tipoDaPorta(destino.data, e.targetHandle)
    if (saida && entrada && !portasCompativeis(saida, entrada)) {
      falhar(destino, `recebe ${TIPOS_DE_PORTA[saida].toLowerCase()} de "${origem.data.rotulo}", mas a entrada é de ${TIPOS_DE_PORTA[entrada].toLowerCase()}.`)
    }
  }

  // toda saída principal precisa estar ligada (senão os envelopes somem em silêncio); vale também para desativado,
  // que repassa os envelopes. Para descartar de propósito, ligue no Fim.
  for (const no of componentes) {
    if (ehDoFluxo(no.data.tipo)) continue
    for (let i = 0; i < qtdSaidas(no.data); i++) {
      if (saidaOpcional(no.data, `out-${i}`)) continue
      if (!edges.some(e => e.source === no.id && e.sourceHandle === `out-${i}`)) {
        const nome = rotuloDaSaida(no.data, i)
        falhar(no, qtdSaidas(no.data) > 1 ? `tem a saída ${nome ? `"${nome}"` : i + 1} sem ligação.` : 'tem a saída sem ligação.')
      }
    }
  }

  for (const no of componentes) {
    const def = POR_TIPO[no.data.tipo]
    if (!def || ehDoFluxo(no.data.tipo) || no.data.desativado) continue
    const entrando = edges.filter(e => e.target === no.id)
    if (entrando.length === 0) {
      falhar(no, 'não está ligado a nada.')
      continue
    }
    if (!chegaAoFim.has(no.id)) falhar(no, 'não chega ao End do fluxo.')
    if (politicaDeErro(no.data) === 'desviar' && !edges.some(e => e.source === no.id && e.sourceHandle === PORTA_DE_ERRO)) {
      falhar(no, 'desvia erros, mas a saída de erro não está ligada.')
    }
    if (!def.entradasOpcionais && entrando.length < qtdEntradas(no.data)) falhar(no, 'tem entrada sem ligação.')
    for (const m of def.validar?.(no.data.config, {recebeLinhas: recebeLinhas(no, nos, edges)}) ?? []) falhar(no, m)
    if (!def.chaveDeSaidaPadrao || no.data.override) continue // grava direto nos campos do envelope (ex.: Mapper) ou substitui o DATA
    const problemaNaChave = problemaNoNome(no.data.chaveDeSaida ?? '')
    if (problemaNaChave) falhar(no, `tem a chave de saída: ${problemaNaChave}.`)
    else if (componentes.some(o => o !== no && !o.data.desativado && o.data.chaveDeSaida === no.data.chaveDeSaida)) {
      falhar(no, `usa a chave de saída "${no.data.chaveDeSaida}", que outro componente também usa.`)
    }
  }

  return pendencias
}
