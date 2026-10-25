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

/** "Run from here": the nodes it is available on (after a run) and the action. */
export const RunFromContext = createContext<{available: Set<string>; run: (nodeId: string) => void}>({available: new Set(), run: () => undefined});

export function useRunFrom() {
  return useContext(RunFromContext);
}
