import {createContext, useContext} from 'react';
import type {AvailableVariable} from '@dataflow/core';

export type Variables = {
  /**
   * Variables an expression can use at the node: what reached it in the runs so far (only at `port`, if given),
   * parameters, secrets and the run.
   */
  of: (nodeId: string, port?: string) => AvailableVariable[];
  /** something already reached the node (at `port`, if given) in a run: a variable outside the list deserves a warning */
  seen: (nodeId: string, port?: string) => boolean;
};

export const VariablesContext = createContext<Variables>({of: () => [], seen: () => false});

export function useVariables() {
  return useContext(VariablesContext);
}
