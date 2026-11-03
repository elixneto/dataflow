import {createContext, useContext} from 'react';
import type {ComponentRun} from '@dataflow/core';

/** Result of each component in the last run (empty when no result is open). */
export const ResultContext = createContext<Record<string, ComponentRun>>({});

export function useResult() {
  return useContext(ResultContext);
}

/** Error warnings per component (configuration issues and errors of the last run), for the sign on the card. */
export const WarningsContext = createContext<Record<string, string[]>>({});

export function useWarnings() {
  return useContext(WarningsContext);
}

/** "Run from here" and Pin on the cards: the nodes each is available on (they have data from a run) and the actions. */
export type RunFromActions = {
  available: Set<string>;
  run: (nodeId: string) => void;
  canPin: Set<string>;
  pin: (nodeId: string) => void;
};

export const RunFromContext = createContext<RunFromActions>({available: new Set(), run: () => undefined, canPin: new Set(), pin: () => undefined});

export function useRunFrom() {
  return useContext(RunFromContext);
}
