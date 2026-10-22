import {createContext, useContext} from 'react'
import type {WorkflowParameter} from '@dataflow/core'

/** Workflow parameters, so the Start card can show how many there are (they live in the editor, not in the node). */
export const ParametersContext = createContext<WorkflowParameter[]>([])

export function useParameters() {
  return useContext(ParametersContext)
}
