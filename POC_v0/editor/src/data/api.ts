import {LOST, reportConnection} from '#data/connection';

/*
 * Saving to the runner's database. The editor works on what it loaded when it opened (data/workspace.ts): each change
 * updates that copy right away and the write goes to the runner in the background, one after the other, in order.
 * A write that fails is reported to whoever listens (the SaveStatus banner).
 */

const API = '/api';

type Listener = (error: string | null) => void;

const listeners = new Set<Listener>();
let queue: Promise<void> = Promise.resolve();

/** listens to the write errors (null = a later write worked); returns the function that stops listening */
export function onSaveError(listener: Listener) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

const notify = (error: string | null) => listeners.forEach(l => l(error));

/** an error answered by the runner (with the HTTP status) */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** a request to the runner; the error message comes from its `{error}` */
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, init);
  } catch {
    reportConnection(LOST);
    throw new Error('The runner did not respond.');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body.error ?? `The runner returned ${response.status}.`, response.status);
  return body as T;
}

/** queues a write (PUT with the body, or DELETE); a DELETE of something that is not there is not an error */
export function persist(method: 'PUT' | 'DELETE', path: string, body?: unknown) {
  queue = queue.then(async () => {
    try {
      await request(path, body === undefined ? {method} : {method, body: JSON.stringify(body), headers: {'content-type': 'application/json'}});
      notify(null);
    } catch (error) {
      if (method === 'DELETE' && error instanceof ApiError && error.status === 404) return;
      notify(`Could not save: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}
