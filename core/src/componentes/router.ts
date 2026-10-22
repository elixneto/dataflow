import {comoErro} from '../envelope'
import type {ComponenteLogica} from '../tipos'

/**
 * Router (no Kettle, Switch / case): N casos, cada um com uma condição em expression e a sua saída (out-0, out-1...),
 * mais a saída else (a última), para o envelope em que nenhum caso deu verdadeiro. Vale o primeiro caso verdadeiro,
 * na ordem da lista. Não mexe no DATA. A else pode ficar sem ligação (descarta).
 */

export type CasoDoRouter = {rotulo: string; condicao: string}

export function casosDoRouter(config: Record<string, unknown>): CasoDoRouter[] {
  return Array.isArray(config.casos) ? (config.casos as CasoDoRouter[]) : []
}

/** Porta da saída else: depois das dos casos. */
export function portaElseDoRouter(config: Record<string, unknown>) {
  return `out-${casosDoRouter(config).length}`
}

export const router: ComponenteLogica = {
  tipo: 'router',
  entradas: ['envelope'],
  // uma por caso + a else; a quantidade vem da configuração
  saidas: ['envelope'],
  saidasOpcionais: config => [portaElseDoRouter(config)],

  validar(config) {
    const casos = casosDoRouter(config)
    if (casos.length === 0) return ['não tem nenhum caso.']
    const pendencias: string[] = []
    casos.forEach((c, i) => {
      if (!c.condicao?.trim()) pendencias.push(`caso ${i + 1} está sem condição.`)
    })
    return pendencias
  },

  async* executar(entradas, config, ctx) {
    const casos = casosDoRouter(config)
    const porCaso = casos.map(() => 0)
    let noElse = 0
    for await (const doc of entradas['in-0'] ?? []) {
      try {
        const i = casos.findIndex(c => ctx.valorDoCampo({valor: c.condicao, expression: true}, doc))
        if (i >= 0) porCaso[i] += 1
        else noElse += 1
        yield {porta: `out-${i >= 0 ? i : casos.length}`, doc}
      } catch (e) {
        yield {erro: comoErro(e), doc}
      }
    }
    ctx.log('info', [...casos.map((c, i) => `${c.rotulo || `caso ${i + 1}`}: ${porCaso[i]}`), `else: ${noElse}`].join(', ') + '.')
  },
}
