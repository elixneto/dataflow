import {acrescentar, comoErro} from '../envelope'
import type {ComponenteLogica, Envelope} from '../tipos'

/**
 * Lookup (no Kettle, Stream lookup): para cada envelope da entrada principal (in-0), procura o envelope da entrada
 * de consulta (in-1) com a mesma chave e grava o DATA dele inteiro na chave de saída do nó (padrão `lookup`; null se
 * não achar). Escolher campos e dar valor padrão é trabalho do Mapper depois dele (ex.: `$empresa?.id`).
 * Com Override, o DATA vira só o envelope achado (vazio se não achar). Ex.: código da empresa no sistema de origem → empresa no destino.
 *
 * Lê a consulta inteira antes de soltar o primeiro envelope (ela fica em memória). Enquanto isso, guarda o que chega
 * na principal, para não travar quando as duas entradas vêm do mesmo lugar. Chaves comparadas como texto
 * (`1` acha `"1"`); com chave repetida na consulta, vale o primeiro envelope.
 */

export type ChaveDoLookup = {principal: string; consulta: string}
export type SeNaoEncontrar = 'nulo' | 'erro'

export function configDoLookup(config: Record<string, unknown>) {
  return {
    chaves: Array.isArray(config.chaves) ? (config.chaves as ChaveDoLookup[]) : [],
    seNaoEncontrar: (config.seNaoEncontrar === 'erro' ? 'erro' : 'nulo') as SeNaoEncontrar,
  }
}

class NaoEncontrado extends Error {
  constructor(chave: string) {
    super(`Lookup não encontrou a chave ${chave}.`)
    this.name = 'NotFound'
  }
}

export const lookup: ComponenteLogica = {
  tipo: 'lookup',
  entradas: ['envelope', 'envelope'],
  saidas: ['envelope'],
  chaveDeSaidaPadrao: 'lookup',

  validar(config) {
    const {chaves} = configDoLookup(config)
    const pendencias: string[] = []
    if (chaves.length === 0) pendencias.push('não tem nenhuma chave.')
    chaves.forEach((c, i) => {
      if (!c.principal?.trim() || !c.consulta?.trim()) pendencias.push(`chave ${i + 1} está incompleta.`)
    })
    return pendencias
  },

  async* executar(entradas, config, ctx) {
    const {chaves, seNaoEncontrar} = configDoLookup(config)
    const chaveDe = (doc: Envelope, lado: 'principal' | 'consulta') =>
      JSON.stringify(chaves.map(c => String(ctx.valorDoCampo({valor: c[lado], expression: true}, doc))))

    const tabela = new Map<string, Envelope>()
    // guarda a principal enquanto a consulta não termina (as duas podem vir do mesmo componente)
    const guardados: Envelope[] = []
    let principalAcabou = false
    const espera: {acordar?: () => void} = {}
    const guardar = (async () => {
      for await (const doc of entradas['in-0'] ?? []) {
        guardados.push(doc)
        ctx.guardando(tabela.size + guardados.length, doc)
        espera.acordar?.()
      }
      principalAcabou = true
      espera.acordar?.()
    })()

    let repetidas = 0
    for await (const doc of entradas['in-1'] ?? []) {
      const chave = chaveDe(doc, 'consulta')
      if (tabela.has(chave)) repetidas += 1
      else {
        tabela.set(chave, doc)
        ctx.guardando(tabela.size + guardados.length, doc)
      }
    }
    ctx.log('info', `Lookup com ${tabela.size} chave(s).`)
    if (repetidas) ctx.log('aviso', `${repetidas} envelope(s) do lookup com chave repetida: vale o primeiro.`)

    let encontrados = 0
    let semPar = 0
    while (true) {
      const doc = guardados.shift()
      if (!doc) {
        if (principalAcabou) break
        await ctx.esperar(new Promise<void>(resolve => (espera.acordar = resolve)))
        espera.acordar = undefined
        continue
      }
      ctx.guardando(tabela.size + guardados.length)
      try {
        const chave = chaveDe(doc, 'principal')
        const achado = tabela.get(chave)
        if (!achado && seNaoEncontrar === 'erro') throw new NaoEncontrado(chave)
        if (achado) encontrados += 1
        else semPar += 1
        const saida: Envelope = ctx.no.override
          ? {WORKFLOW_CURRENT_RUN: doc.WORKFLOW_CURRENT_RUN, PARAMETERS: doc.PARAMETERS, DATA: {...achado?.DATA}}
          : acrescentar(doc, ctx.no.chaveDeSaida || 'lookup', achado ? achado.DATA : null)
        yield {porta: 'out-0', doc: saida}
      } catch (e) {
        yield {erro: comoErro(e), doc}
      }
    }
    await guardar
    ctx.log('info', `${encontrados} envelope(s) encontrado(s) e ${semPar} sem par no lookup.`)
  },
}
