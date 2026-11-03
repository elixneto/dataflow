import type {ComponentRun} from '@dataflow/core';

/*
 * The editor's test runs (mode `validation`) are not stored by the runner: the latest result of each node that ran
 * (with its samples, at most 50 envelopes per port) is kept here, in this browser's IndexedDB, one entry per flow for
 * its current version. Storing a newer version replaces the older one. Without IndexedDB (private window, blocked
 * storage) everything still works, only until reload.
 */

const DATABASE = 'dataflow';
const STORE = 'validation-runs';

type Entry = {flowId: string; version: number; components: Record<string, ComponentRun>};

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, {keyPath: 'flowId'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(error => {
    opening = null;
    throw error;
  });
  return opening;
}

async function withStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const request = work(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** The latest result of each node of the flow at this version (empty if there is none or no storage). */
export async function loadValidationRuns(flowId: string, version: number): Promise<Record<string, ComponentRun>> {
  try {
    const entry = await withStore<Entry | undefined>('readonly', store => store.get(flowId) as IDBRequest<Entry | undefined>);
    if (!entry) return {};
    if (entry.version < version) await forgetValidationRuns(flowId);
    return entry.version === version ? entry.components : {};
  } catch {
    return {};
  }
}

/** Keeps the latest result of each node of the flow at this version (replaces what an older version had). */
export async function saveValidationRuns(flowId: string, version: number, components: Record<string, ComponentRun>) {
  try {
    await withStore('readwrite', store => store.put({flowId, version, components} satisfies Entry));
  } catch {
    // no storage (or full): the results only last until reload
  }
}

export async function forgetValidationRuns(flowId: string) {
  try {
    await withStore('readwrite', store => store.delete(flowId));
  } catch {
    // nothing stored
  }
}
