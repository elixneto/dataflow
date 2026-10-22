import {problemaNoNome} from '../envelope'
import type {ComponenteLogica, Envelope} from '../tipos'

/**
 * Aggregate: junta os envelopes em lotes de N e solta um envelope por lote, com a lista dos DATA num campo
 * (padrão `items`): {items: [DATA, DATA, ...]}. O último lote pode vir menor. Serve para mandar vários registros
 * de uma vez para uma API ou um banco (ex.: Aggregate de 500 → TypeScript que faz uma chamada por lote).
 */

export const MAX_TAMANHO_DO_LOTE = 10_000

export function configDoAggregate(config: Record<string, unknown>) {
  const n = Math.round(Number(config.tamanho ?? 500))
  return {
    tamanho: Number.isFinite(n) ? Math.min(MAX_TAMANHO_DO_LOTE, Math.max(1, n)) : 500,
    campo: typeof config.campo === 'string' ? config.campo : 'items',
  }
}

export const aggregate: ComponenteLogica = {
  tipo: 'aggregate',
  entradas: ['envelope'],
  saidas: ['envelope'],

  validar(config) {
    const problema = problemaNoNome(configDoAggregate(config).campo)
    return problema ? [`campo ${problema}.`] : []
  },

  async* executar(entradas, config, ctx) {
    const {tamanho, campo} = configDoAggregate(config)
    let lote: Envelope[] = []
    let lotes = 0
    let entrou = 0
    const soltar = () => {
      lotes += 1
      const doc: Envelope = {WORKFLOW_CURRENT_RUN: lote[0].WORKFLOW_CURRENT_RUN, PARAMETERS: lote[0].PARAMETERS, DATA: {[campo]: lote.map(d => d.DATA)}}
      lote = []
      ctx.guardando(0)
      return {porta: 'out-0', doc}
    }
    for await (const doc of entradas['in-0'] ?? []) {
      entrou += 1
      lote.push(doc)
      ctx.guardando(lote.length, doc)
      if (lote.length >= tamanho) yield soltar()
    }
    if (lote.length) yield soltar()
    ctx.log('info', `${entrou} envelope(s) em ${lotes} lote(s) de até ${tamanho}.`)
  },
}
