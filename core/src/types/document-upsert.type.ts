/** One upsert: the document matching `filter` gets the fields of `document` (`$set`); without a match, it is inserted. */
export type DocumentUpsert = {
  filter: Record<string, unknown>;
  document: Record<string, unknown>;
};
