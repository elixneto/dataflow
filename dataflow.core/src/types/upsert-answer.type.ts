import type {UpsertResult} from '#types/upsert-result.type';

/** The answer to a batch of upserts: one result per upsert, in order, and how many matched documents changed. */
export type UpsertAnswer = {results: UpsertResult[]; modified: number};
