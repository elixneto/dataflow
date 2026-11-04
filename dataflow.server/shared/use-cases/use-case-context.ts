import type { Keyring } from '#shared/crypto/keyring';
import type { Database } from '#shared/database/database';

/**
 * Who is asking and where. Every handler gets it, so every repository can filter by orgId: a use case never reads
 * or writes another organization's rows.
 */
export type UseCaseContext = {
  orgId: string;
  userId: string;
  db: Database;
  /** encrypts and decrypts secrets' values; only the secrets use cases need it */
  keyring?: Keyring;
};
