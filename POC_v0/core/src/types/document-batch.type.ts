import type {DocumentUpsert} from '#types/document-upsert.type';

/** A batch of upserts into one collection, as the runner's driver receives it: the connection string is already resolved. */
export type DocumentBatch = {
  connection: string;
  database: string;
  collection: string;
  upserts: DocumentUpsert[];
  /** run interrupted (Stop, timeout, failure in another component): stops sending */
  signal: AbortSignal;
};
