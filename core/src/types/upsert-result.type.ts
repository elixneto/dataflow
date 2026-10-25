/** What the database answered for one upsert, in the same order as the batch: the counts, or why that one failed. */
export type UpsertResult =
  | {matched: number; modified: number; upsertedId: string | null}
  | {error: string};
