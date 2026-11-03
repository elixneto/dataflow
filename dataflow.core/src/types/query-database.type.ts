import type {DatabaseQuery} from '#types/database-query.type';

/**
 * A database driver: runs a read-only query and yields the rows one by one, with backpressure (the database pauses
 * while the flow does not consume). Lives in the runner; the core only receives the function, like the expression evaluator.
 */
export type QueryDatabase = (query: DatabaseQuery) => AsyncIterable<Record<string, unknown>>;
