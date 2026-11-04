import { eq } from 'drizzle-orm';
import type { Database } from '#shared/database/database';
import { OrgRepository } from '#shared/database/repository';
import { KeyringError } from '#shared/crypto/keyring';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import { secrets, type Secret } from './secret';

/*
 * Reading and writing a project's secrets. A value goes in encrypted (ctx.keyring) and never comes back out through
 * the api: only the runner decrypts it, to run a flow.
 */

export class SecretRepository extends OrgRepository<typeof secrets> {
  constructor(db: Database, orgId: string) {
    super(db, secrets, orgId);
  }
}

/** the project's secrets (without decrypting anything) */
export const projectSecrets = (db: Database, orgId: string, projectId: string): Promise<Secret[]> =>
  new SecretRepository(db, orgId).findMany(eq(secrets.projectId, projectId));

function keyringOf(ctx: UseCaseContext) {
  if (!ctx.keyring) {
    throw new KeyringError('No keyring: secrets cannot be stored.');
  }

  return ctx.keyring;
}

/** a new secret, its value encrypted; `db` may be a transaction */
export async function insertSecret(db: Database, ctx: UseCaseContext, projectId: string, name: string, value: string): Promise<Secret> {
  const id = crypto.randomUUID();
  const encrypted = await keyringOf(ctx).encrypt(value, id, name);
  return new SecretRepository(db, ctx.orgId).insert({ id, projectId, name, ...encrypted, updatedBy: ctx.userId });
}

/** a new value for an existing secret (new nonce; the current key) */
export async function replaceSecretValue(ctx: UseCaseContext, secret: Secret, value: string): Promise<Secret | null> {
  const encrypted = await keyringOf(ctx).encrypt(value, secret.id, secret.name);
  return new SecretRepository(ctx.db, ctx.orgId).update(secret.id, { ...encrypted, updatedAt: new Date(), updatedBy: ctx.userId });
}
