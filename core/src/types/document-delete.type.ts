/** A delete on a document database, as the runner's driver receives it: the connection string is already resolved. */
export type DocumentDelete = {
  connection: string;
  database: string;
  collection: string;
  /** the filter, as the component evaluated it on the envelope (Extended JSON such as {$oid} or {$date} is accepted) */
  filter: Record<string, unknown>;
  /** only count the documents the filter matches, delete nothing (a test run) */
  countOnly?: boolean;
  /** run interrupted (Stop, timeout, failure in another component) */
  signal: AbortSignal;
};
