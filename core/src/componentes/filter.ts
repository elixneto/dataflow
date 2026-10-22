import {comoErro} from '../envelope'
import type {ComponenteLogica} from '../tipos'

/**
 * Filter (no Kettle, Filter rows): avalia uma condição em expression para cada envelope e manda o envelope,
 * sem mexer no DATA, para a saída true (out-0) ou false (out-1). A false pode ficar sem ligação (descarta). Vale a regra do JS: `0`, `""`, `null` etc. são false.
 */

export function condicaoDoFilter(config: Record<string, unknown>): string {
  return typeof config.condicao === 'string' ? config.condicao : ''
}

export const filter: ComponenteLogica = {
  tipo: 'filter',
  entradas: ['envelope'],
  saidas: ['envelope', 'envelope'],
  saidasOpcionais: ['out-1'],

  validar(config) {
    return condicaoDoFilter(config).trim() ? [] : ['não tem a condição.']
  },

  async* executar(entradas, config, ctx) {
    const condicao = condicaoDoFilter(config)
    let verdadeiros = 0
    let falsos = 0
    for await (const doc of entradas['in-0'] ?? []) {
      try {
        if (ctx.valorDoCampo({valor: condicao, expression: true}, doc)) {
          verdadeiros += 1
          yield {porta: 'out-0', doc}
        } else {
          falsos += 1
          yield {porta: 'out-1', doc}
        }
      } catch (e) {
        yield {erro: comoErro(e), doc}
      }
    }
    ctx.log('info', `${verdadeiros} envelope(s) em true e ${falsos} em false.`)
  },
}
