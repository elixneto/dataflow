/**
 * What the database answered for one upsert, in the same order as the batch: whether it found a document (matched) or
 * inserted one (upsertedId), or why that one failed. Whether a matched document changed (`modified`) is only known for
 * a batch of one, written on its own; a bulk write answers it only as a total (UpsertAnswer.modified).
 */
export type UpsertResult =
  | {matched: number; upsertedId: string | null; modified?: number}
  | {error: string};
