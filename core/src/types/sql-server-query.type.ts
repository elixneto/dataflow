/** A database query (SQL Server Query): the connection string is already resolved from the secret. */
export type SqlServerQuery = {
  connection: string;
  sql: string;
  /** values of the @parameters, sent to the database as parameters (never pasted into the text) */
  parameters: Record<string, unknown>;
  timeoutMs: number;
  /** run interrupted (Stop, timeout, failure in another component): cancels the query in the database */
  signal: AbortSignal;
};
