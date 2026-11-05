import { useEffect, useSyncExternalStore } from 'react';
import type { FlowCall } from '@dataflow/core';
import { getFlowCalls, type FlowCalls } from '@/data/flows/flows-api';

/*
 * The calls between a project's flows, shared by the flow editor (the Calls chip in its top bar, a Flow Invoker's
 * settings): read when one of them needs it, again on demand at most every REFRESH_MS (opening the chip reads them
 * right away). Nothing is read in the background.
 */

const REFRESH_MS = 10_000;

type Entry = { data: FlowCalls | null; at: number; loading: boolean };
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

/** reads the project's calls, unless they were read in the last REFRESH_MS (`now`: read them anyway) */
export function loadProjectCalls(projectId: string, now = false): void {
  const entry = entries.get(projectId);
  if (!projectId || entry?.loading || (!now && entry && Date.now() - entry.at < REFRESH_MS)) {
    return;
  }

  entries.set(projectId, { data: entry?.data ?? null, at: Date.now(), loading: true });
  void getFlowCalls(projectId).then(answer => {
    entries.set(projectId, { data: answer.ok ? answer.value : (entries.get(projectId)?.data ?? null), at: Date.now(), loading: false });
    listeners.forEach(listener => listener());
  });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** the project's calls as last read (null until then); reads them when they are not fresh */
export function useProjectCalls(projectId: string): FlowCalls | null {
  const data = useSyncExternalStore(
    subscribe,
    () => entries.get(projectId)?.data ?? null,
    () => null,
  );
  useEffect(() => loadProjectCalls(projectId), [projectId]);
  return data;
}

/** the project's calls with a flow's own as the editor has them now (not saved yet, or saved after the last read) */
export const withOwnCalls = (calls: FlowCall[], flowId: string, own: FlowCall[] | null): FlowCall[] =>
  own ? [...calls.filter(c => c.from !== flowId), ...own] : calls;
