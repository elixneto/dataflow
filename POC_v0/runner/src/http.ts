import type {SendHttp} from '@dataflow/core';

/*
 * HTTP Request: the request with fetch, stopped by the run (Stop, timeout of the run) or by its own timeout. Any
 * status is an answer (the component decides what an error status means); only no answer rejects.
 */
export const sendHttp: SendHttp = async ({method, url, headers, body, timeoutMs, signal}) => {
  const timeout = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {method, headers, body, signal: AbortSignal.any([signal, timeout]), redirect: 'follow'});
  } catch (e) {
    if (timeout.aborted) throw Object.assign(new Error(`No answer in ${Math.round(timeoutMs / 1000)} s (timeout).`), {name: 'TimeoutError'});
    if (signal.aborted) throw Object.assign(new Error('Request cancelled.'), {name: 'AbortError'});
    throw Object.assign(new Error(`Could not reach the server: ${e instanceof Error ? e.message : String(e)}`), {name: 'NetworkError'});
  }
  return {status: response.status, headers: Object.fromEntries([...response.headers].map(([k, v]) => [k.toLowerCase(), v])), body: await response.text()};
};
