import {acrescentar, comoErro} from '../envelope'
import type {ComponenteLogica} from '../tipos'

/**
 * TypeScript: o usuário escreve `async function process($input)` (e quantas funções auxiliares quiser).
 * $input é o DATA do envelope (para processar vários de uma vez, ponha um Aggregate antes).
 * Sem Override, o retorno (qualquer valor) vai para a chave de saída do nó ($resultado) e o envelope segue com o resto.
 * Com Override, o retorno vira o DATA inteiro: objeto = 1 envelope, lista = 1 por item, null/undefined = nenhum.
 * Exceção é erro do envelope (segue a política "Em caso de erro"). Globais: $PARAMETERS, $SECRETS,
 * $WORKFLOW_CURRENT_RUN e log().
 */

export const CODIGO_PADRAO = `async function process($input: Data) {
  return null
}
`

export function configDoTypescript(config: Record<string, unknown>) {
  return {codigo: typeof config.codigo === 'string' ? config.codigo : CODIGO_PADRAO}
}

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export const typescript: ComponenteLogica = {
  tipo: 'typescript',
  entradas: ['envelope'],
  saidas: ['envelope'],
  chaveDeSaidaPadrao: 'resultado',

  validar(config) {
    const {codigo} = configDoTypescript(config)
    return /\bfunction\s+process\s*\(/.test(codigo) ? [] : ['não tem a função process.']
  },

  async* executar(entradas, config, ctx) {
    const {codigo} = configDoTypescript(config)
    const processar = await ctx.prepararScript(codigo)
    let entrou = 0
    let saiu = 0
    for await (const doc of entradas['in-0'] ?? []) {
      entrou += 1
      try {
        const retorno = await processar(doc.DATA)
        if (!ctx.no.override) {
          saiu += 1
          yield {porta: 'out-0', doc: acrescentar(doc, ctx.no.chaveDeSaida || 'resultado', retorno ?? null)}
          continue
        }
        if (retorno === null || retorno === undefined) continue
        const itens = Array.isArray(retorno) ? retorno : [retorno]
        if (!itens.every(ehObjeto)) throw new TypeError('Com Override, process deve devolver um objeto, uma lista de objetos ou null.')
        for (const DATA of itens) {
          saiu += 1
          yield {porta: 'out-0', doc: {WORKFLOW_CURRENT_RUN: doc.WORKFLOW_CURRENT_RUN, PARAMETERS: doc.PARAMETERS, DATA}}
        }
      } catch (e) {
        yield {erro: comoErro(e), doc}
      }
    }
    ctx.log('info', `${entrou} envelope(s) entraram e ${saiu} saíram.`)
  },
}
