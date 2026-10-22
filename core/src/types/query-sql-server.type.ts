import type {SqlServerQuery} from '#types/sql-server-query.type';

/**
 * Runs a read-only query and yields the rows one by one, with backpressure (the database pauses while the
 * flow does not consume). Lives in the runner (database driver); the core only receives the function, like the expression evaluator.
 */
export type QuerySqlServer = (query: SqlServerQuery) => AsyncIterable<Record<string, unknown>>;
