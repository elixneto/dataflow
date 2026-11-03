import type {DocumentQuery} from '#types/document-query.type';

/**
 * A document database driver that reads: runs an aggregation pipeline and yields the documents one by one, with
 * backpressure (the cursor fetches the next batch only when the flow asks), as plain JSON values (ids as text, dates
 * as ISO). Lives in the runner; the core only receives the function.
 */
export type AggregateDocuments = (query: DocumentQuery) => AsyncIterable<Record<string, unknown>>;
