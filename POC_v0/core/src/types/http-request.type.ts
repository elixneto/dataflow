/** An HTTP request, as the runner's function receives it (the component already evaluated URL, headers and body). */
export type HttpRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  /** the body as text (an object was already turned into JSON); none for a GET */
  body?: string;
  timeoutMs: number;
  /** run interrupted (Stop, timeout, failure in another component): cancels the request */
  signal: AbortSignal;
};
