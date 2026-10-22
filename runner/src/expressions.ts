import vm from 'node:vm'
import {comoErro, type AvaliarExpression} from '@dataflow/core'

/** Tempo máximo de uma expression: loop infinito vira erro da linha, não trava o runner. */
const TEMPO_MAXIMO_MS = 1000

/**
 * Avalia uma expression num contexto novo e vazio do node:vm: só as variáveis do envelope ficam à vista
 * ($WORKFLOW_CURRENT_RUN, $PARAMETERS, $SECRETS e as chaves do DATA). Sem require, process, rede ou disco.
 */
export const avaliar: AvaliarExpression = (expression, variaveis) => {
  try {
    return vm.runInNewContext(`(${expression}\n)`, {...variaveis}, {timeout: TEMPO_MAXIMO_MS})
  } catch (e) {
    const original = comoErro(e)
    const erro = new Error(`Expression "${expression}": ${original.message}`)
    // mantém o tipo original (ReferenceError, TypeError...): vai para DATA.errors[].error
    erro.name = original.name
    throw erro
  }
}
