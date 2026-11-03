/** The answer to an HTTP request: the status, the headers (names in lower case) and the body as text. */
export type HttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};
