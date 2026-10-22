import {createContext, useContext} from 'react'
import type {ParametroDoWorkflow} from '@dataflow/core'

/** Parâmetros do workflow, para o card do Início mostrar quantos são (eles ficam no editor, não no nó). */
export const ParametrosContext = createContext<ParametroDoWorkflow[]>([])

export function useParametros() {
  return useContext(ParametrosContext)
}
