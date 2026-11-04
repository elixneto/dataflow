import { customType, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from '#features/organizations/organization';
import { projects } from '#features/projects/project';
import type { Bytes } from '#shared/crypto/keyring';

const bytea = customType<{ data: Bytes; driverData: Uint8Array }>({
  dataType: () => 'bytea',
  // PGlite and Bun's client give a Uint8Array (or a Buffer): copied into a plain one for WebCrypto
  fromDriver: value => new Uint8Array(value),
});

/** follows migrations/1_initial.sql; the value only as AES-256-GCM ciphertext */
export const secrets = pgTable('secrets', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  /** null = a secret of the whole organization (not used yet) */
  projectId: uuid('project_id').references(() => projects.id),
  name: text('name').notNull(),
  /** which key of the keyring encrypted it */
  keyVersion: text('key_version').notNull(),
  nonce: bytea('nonce').notNull(),
  ciphertext: bytea('ciphertext').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Secret = typeof secrets.$inferSelect;

/** a secret as the api shows it: never its value */
export type SecretView = { id: string; projectId: string | null; name: string; createdAt: Date; updatedAt: Date; updatedBy: string | null };

export const toSecretView = (secret: Secret): SecretView => ({
  id: secret.id,
  projectId: secret.projectId,
  name: secret.name,
  createdAt: secret.createdAt,
  updatedAt: secret.updatedAt,
  updatedBy: secret.updatedBy,
});
