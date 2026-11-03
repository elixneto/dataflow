/** A database query, as the runner's driver receives it: the connection string is already resolved from the secret. */
export type DatabaseQuery = {
  connection: string;
  sql: string;
  /** values of the query parameters, sent to the database as parameters (never pasted into the text) */
  parameters: Record<string, unknown>;
  timeoutMs: number;
  /** run interrupted (Stop, timeout, failure in another component): cancels the query in the database */
  signal: AbortSignal;
};
