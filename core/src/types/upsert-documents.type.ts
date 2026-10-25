import type {DocumentBatch} from '#types/document-batch.type';
import type {UpsertResult} from '#types/upsert-result.type';

/**
 * A document database driver: writes a batch of upserts and answers one result per upsert, in order (one that fails does
 * not stop the others). Lives in the runner; the core only receives the function. A failure of the whole batch
 * (connection, authentication) rejects.
 */
export type UpsertDocuments = (batch: DocumentBatch) => Promise<UpsertResult[]>;
