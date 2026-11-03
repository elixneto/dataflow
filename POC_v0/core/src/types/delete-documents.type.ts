import type {DocumentDelete} from '#types/document-delete.type';

/**
 * A document database driver that deletes: removes every document the filter matches (deleteMany) and answers how
 * many; with `countOnly`, only counts them. Lives in the runner; the core only receives the function.
 */
export type DeleteDocuments = (request: DocumentDelete) => Promise<number>;
