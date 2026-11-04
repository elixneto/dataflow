import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { secretNameError, secretValueError, validateProfile, type ProfileFields } from '@dataflow/core';
import { projectSecrets } from '#features/secrets/secret-store';
import type { Database } from '#shared/database/database';
import { OrgRepository } from '#shared/database/repository';
import { fieldErrors } from '#shared/use-cases/field-errors';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseResult } from '#shared/use-cases/use-case-result';
import { connections, type Connection } from './connection';

export class ConnectionRepository extends OrgRepository<typeof connections> {
  constructor(db: Database, orgId: string) {
    super(db, connections, orgId);
  }

  /** the project's connection profiles by name */
  async ofProject(projectId: string): Promise<Connection[]> {
    return (await this.findMany(eq(connections.projectId, projectId))).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  }
}

/** what create and update receive: the profile, and the secrets typed in its form (created with it) */
export const ProfileInput = {
  name: z.string(),
  type: z.string(),
  config: z.record(z.string(), z.string()),
  newSecrets: z.array(z.object({ name: z.string().trim(), value: z.string() })).default([]),
};

/**
 * Checks a profile and the new secrets typed in its form, before anything is written: each new secret's name (rule,
 * unique against the project's secrets and the other new ones) and value, then the profile with the new secrets
 * counted as existing (@dataflow/core validateProfile, the editor's rules). A new secret's error comes under the field
 * that names it. Returns the cleaned profile, or the failure.
 */
export async function checkProfile(
  ctx: UseCaseContext,
  projectId: string,
  fields: { name: string; type: string; config: Record<string, string> },
  newSecrets: { name: string; value: string }[],
  exceptId?: string,
): Promise<{ value: ProfileFields } | { failure: UseCaseResult<never> }> {
  const existing = (await projectSecrets(ctx.db, ctx.orgId, projectId)).map(s => s.name);
  const errors: Record<string, string | undefined> = {};
  newSecrets.forEach((secret, i) => {
    const others = [...existing, ...newSecrets.slice(0, i).map(s => s.name)].map(name => ({ name }));
    const error = secretNameError(secret.name, others) ?? secretValueError(secret.value);
    if (error) {
      const field = Object.keys(fields.config).find(key => fields.config[key] === secret.name) ?? 'newSecrets';
      errors[field] = `Secret ${secret.name}: ${error}`;
    }
  });

  const others = (await new ConnectionRepository(ctx.db, ctx.orgId).ofProject(projectId)).map(c => ({ id: c.id, name: c.name }));
  const profile = validateProfile(fields as ProfileFields, others, [...existing, ...newSecrets.map(s => s.name)], exceptId);
  const failure = fieldErrors({ ...profile.errors, ...errors });
  return failure ? { failure } : { value: profile.value };
}

/** only the new secrets a field of the saved profile still names */
export const usedSecrets = (profile: ProfileFields, newSecrets: { name: string; value: string }[]) => {
  const used = new Set(Object.values(profile.config));
  return newSecrets.filter(secret => used.has(secret.name));
};
