/** An aggregation on a document database, as the runner's driver receives it: the connection string is already resolved. */
export type DocumentQuery = {
  connection: string;
  database: string;
  collection: string;
  /** the stages, as the component evaluated them on the envelope (Extended JSON such as {$oid} or {$date} is accepted) */
  pipeline: Record<string, unknown>[];
  timeoutMs: number;
  /** run interrupted (Stop, timeout, failure in another component): closes the cursor */
  signal: AbortSignal;
};
