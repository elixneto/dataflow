import type {DocumentBatch} from '#types/document-batch.type';
import type {UpsertAnswer} from '#types/upsert-answer.type';

/**
 * A document database driver: writes a batch of upserts together (one bulk write; a batch of one, on its own) and
 * answers one result per upsert, in order (one that fails does not stop the others), plus the batch's count of
 * modified documents. Lives in the runner; the core only receives the function. A failure of the whole batch
 * (connection, authentication) rejects.
 */
export type UpsertDocuments = (batch: DocumentBatch) => Promise<UpsertAnswer>;
