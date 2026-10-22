import {Canal} from '../canal'
import type {ComponenteLogica, Envelope} from '../tipos'

/**
 * Union: junta N caminhos numa saída só, sem mexer no DATA (no SnapLogic, Union).
 * Cada envelope sai assim que chega, de qualquer entrada.
 */

export const MIN_ENTRADAS_DO_UNIR = 2
export const MAX_ENTRADAS_DO_UNIR = 100

export function qtdEntradasDoUnir(config: Record<string, unknown>) {
  const n = Number(config.qtdEntradas ?? MIN_ENTRADAS_DO_UNIR)
  return Math.min(MAX_ENTRADAS_DO_UNIR, Math.max(MIN_ENTRADAS_DO_UNIR, Number.isFinite(n) ? Math.round(n) : MIN_ENTRADAS_DO_UNIR))
}

export const unir: ComponenteLogica = {
  tipo: 'union',
  entradas: ['envelope'],
  saidas: ['envelope'],
  entradasVariaveis: {min: MIN_ENTRADAS_DO_UNIR, max: MAX_ENTRADAS_DO_UNIR, chave: 'qtdEntradas'},

  validar() {
    return []
  },

  async* executar(entradas, config, ctx) {
    const portas = Array.from({length: qtdEntradasDoUnir(config)}, (_, i) => `in-${i}`).filter(p => entradas[p])
    let total = 0

    // cada entrada despeja numa fila comum; a saída lê a fila na ordem de chegada
    const fila = new Canal<Envelope>()
    const despejos = portas.map(async porta => {
      for await (const doc of entradas[porta]) await ctx.esperar(fila.enviar(doc))
    })
    Promise.all(despejos).finally(() => fila.fechar())
    for await (const doc of ctx.esperarCada(fila)) {
      total += 1
      yield {porta: 'out-0', doc}
    }
    await Promise.all(despejos)

    ctx.log('info', `${total} envelope(s) unido(s) de ${portas.length} entrada(s).`)
  },
}
