import { connectionType, isConnectionType, validateProfile, type ConnectionTypeName } from '@dataflow/core';
import { projectSecrets } from '#features/secrets/secret-store';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import { fail, success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { safeMessage, type ConnectionTest } from './connection-test';
import { MongoDbConnectionTest } from './mongodb-connection-test';
import { SqlServerConnectionTest } from './sqlserver-connection-test';

export type TestConnectionResponse = { message: string; ms: number };

export type ConnectionTests = Partial<Record<ConnectionTypeName, ConnectionTest>>;

/** the types with a live test; the others are only checked for completeness */
export const LIVE_TESTS: ConnectionTests = {
  mongodb: new MongoDbConnectionTest(),
  sqlserver: new SqlServerConnectionTest(),
};

/**
 * Tests a profile, saved or still in its form. It must be complete (the name aside) and every secret it names must be
 * a project secret or one of `newSecrets` (typed in the form, not saved: used for this test only). Then the types with
 * a live test connect, the secrets decrypted in memory for that only; a failure is 'unavailable' with the driver's
 * message, secret values masked.
 */
export async function testProfile(
  ctx: UseCaseContext,
  tests: ConnectionTests,
  projectId: string,
  fields: { type: string; config: Record<string, string> },
  newSecrets: { name: string; value: string }[] = [],
): Promise<UseCaseResult<TestConnectionResponse>> {
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  if (!isConnectionType(fields.type)) {
    return fail('validation', `Unknown connection type "${fields.type}".`, { type: 'Unknown type' });
  }

  const stored = await projectSecrets(ctx.db, ctx.orgId, projectId);
  const typed = newSecrets.filter(s => s.value !== '');
  const { value, errors } = validateProfile(
    { name: 'test', type: fields.type, config: fields.config },
    [],
    [...stored.map(s => s.name), ...typed.map(s => s.name)],
  );
  const problems = Object.entries(errors).map(([field, error]) => `${field}: ${error}`);
  if (problems.length > 0) {
    return fail('validation', `Incomplete: ${problems.join('; ')}.`, errors);
  }

  const live = tests[fields.type];
  if (!live) {
    return success({ message: 'Complete; a live test comes with the connectors.', ms: ms() });
  }

  // the secret fields that apply, by the name they hold: typed in the form, or stored (decrypted)
  const secrets: Record<string, string> = {};
  for (const field of connectionType(fields.type).fields.filter(f => f.kind === 'secret' && value.config[f.key])) {
    const name = value.config[field.key];
    const fresh = typed.find(s => s.name === name);
    if (fresh) {
      secrets[field.key] = fresh.value;
      continue;
    }

    if (!ctx.keyring) {
      return fail('unavailable', 'No keyring: the secrets cannot be read to connect.');
    }

    const secret = stored.find(s => s.name === name)!;
    secrets[field.key] = await ctx.keyring.decrypt(secret, secret.id, secret.name);
  }

  try {
    const reached = await live.test({ config: value.config, secrets });
    return success({ message: `Connected to ${reached}.`, ms: ms() });
  } catch (error) {
    return fail('unavailable', safeMessage(error, Object.values(secrets)));
  }
}
