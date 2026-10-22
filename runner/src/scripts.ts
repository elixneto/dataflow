import vm from 'node:vm'
import {comoErro, type PrepararScript} from '@dataflow/core'

/** Tempo da parte síncrona de uma chamada (loop infinito vira erro, não trava o runner). */
const TEMPO_SINCRONO_MS = 5_000
/** Tempo total de uma chamada do process, contando o que ela espera (fetch etc.). */
const TEMPO_DA_CHAMADA_MS = Number(process.env.RUNNER_SCRIPT_TEMPO_MS ?? 30_000)

const transpilador = new Bun.Transpiler({loader: 'ts', deadCodeElimination: false, treeShaking: false, trimUnusedImports: false})

/**
 * Componente TypeScript: tira os tipos (Bun.Transpiler) e roda o código num contexto novo do node:vm, com as
 * globais do run e o mínimo para chamar APIs (fetch, URL, setTimeout...). Sem require, process, disco.
 * O node:vm separa o escopo, mas não é uma barreira de segurança: o código é de quem tem acesso ao editor (rode o runner só em ambiente de confiança).
 */
export const prepararScript: PrepararScript = async (codigo, globais) => {
  let js: string
  try {
    js = transpilador.transformSync(codigo)
  } catch (e) {
    throw new SyntaxError(`O código não compila: ${comoErro(e).message}`)
  }
  const contexto = vm.createContext({
    $PARAMETERS: globais.parametros,
    $SECRETS: globais.segredos,
    $WORKFLOW_CURRENT_RUN: globais.run,
    log: (...partes: unknown[]) => globais.log(partes.map(p => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')),
    console: {log: (...partes: unknown[]) => globais.log(partes.map(p => (typeof p === 'string' ? p : JSON.stringify(p))).join(' '))},
    fetch, Headers, Request, Response, URL, URLSearchParams, AbortController, FormData, Blob,
    TextEncoder, TextDecoder, atob, btoa, structuredClone, setTimeout, clearTimeout,
    crypto: {randomUUID: () => crypto.randomUUID()},
  })
  try {
    vm.runInContext(js, contexto, {timeout: TEMPO_SINCRONO_MS, filename: 'componente.ts'})
  } catch (e) {
    throw comoErro(e)
  }
  if (vm.runInContext('typeof process', contexto) !== 'function') throw new Error('O código não tem a função process.')

  return async input => {
    contexto.__input = input
    const promessa = vm.runInContext('process(__input)', contexto, {timeout: TEMPO_SINCRONO_MS}) as Promise<unknown>
    let relogio: ReturnType<typeof setTimeout> | undefined
    const estouro = new Promise<never>((_, rejeitar) => {
      relogio = setTimeout(() => rejeitar(new Error(`process passou de ${TEMPO_DA_CHAMADA_MS / 1000} s.`)), TEMPO_DA_CHAMADA_MS)
    })
    try {
      return await Promise.race([promessa, estouro])
    } finally {
      clearTimeout(relogio)
    }
  }
}
