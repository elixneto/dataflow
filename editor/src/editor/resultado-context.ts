import {createContext, useContext} from 'react'
import type {ExecucaoDoComponente} from '@dataflow/core'

/** Resultado de cada componente na última execução (vazio quando não há resultado aberto). */
export const ResultadoContext = createContext<Record<string, ExecucaoDoComponente>>({})

export function useResultado() {
  return useContext(ResultadoContext)
}

/** Avisos de erro por componente (pendências da montagem e erros da última execução), para o sinal no card. */
export const AvisosContext = createContext<Record<string, string[]>>({})

export function useAvisos() {
  return useContext(AvisosContext)
}
