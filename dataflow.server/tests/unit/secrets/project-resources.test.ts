import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { CreateConnectionHandler } from '#features/connections/create-connection/create-connection-handler';
import { DeleteConnectionHandler } from '#features/connections/delete-connection/delete-connection-handler';
import { ListConnectionsHandler } from '#features/connections/list-connections/list-connections-handler';
import { TestConnectionHandler } from '#features/connections/test-connection/test-connection-handler';
import { UpdateConnectionHandler } from '#features/connections/update-connection/update-connection-handler';
import { ProjectRepository } from '#features/projects/project-repository';
import { CreateSecretHandler } from '#features/secrets/create-secret/create-secret-handler';
import { DeleteSecretHandler } from '#features/secrets/delete-secret/delete-secret-handler';
import { ListSecretsHandler } from '#features/secrets/list-secrets/list-secrets-handler';
import { SetSecretValueHandler } from '#features/secrets/set-secret/set-secret-handler';
import { SecretRepository } from '#features/secrets/secret-store';
import { CreateVariableHandler } from '#features/variables/create-variable/create-variable-handler';
import { DeleteVariableHandler } from '#features/variables/delete-variable/delete-variable-handler';
import { ListVariablesHandler } from '#features/variables/list-variables/list-variables-handler';
import { UpdateVariableHandler } from '#features/variables/update-variable/update-variable-handler';
import { Keyring } from '#shared/crypto/keyring';
import { openDatabase, type Database } from '#shared/database/database';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseResult } from '#shared/use-cases/use-case-result';

setDefaultTimeout(30_000);

describe('secrets, variables and connections', () => {
  let db: Database;
  let ctx: UseCaseContext;
  let otherOrgCtx: UseCaseContext;
  const keyring = new Keyring([{ version: 'test', key: new Uint8Array(32).fill(3) }]);

  const value = <T,>(result: UseCaseResult<T>): T => {
    if (!result.ok) {
      throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
    }

    return result.value;
  };

  const newProject = async () =>
    (await new ProjectRepository(db, ctx.orgId).insert({ id: crypto.randomUUID(), name: crypto.randomUUID(), description: '' })).id;
  const secretNames = async (projectId: string) => value(await new ListSecretsHandler().handle({ projectId }, ctx)).items.map(s => s.name);

  beforeAll(async () => {
    db = await openDatabase('memory://');
    ctx = { orgId: crypto.randomUUID(), userId: 'ana', db, keyring };
    otherOrgCtx = { orgId: crypto.randomUUID(), userId: 'bia', db, keyring };
    for (const orgId of [ctx.orgId, otherOrgCtx.orgId]) {
      await db.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [orgId, `org ${orgId}`]);
    }
  });

  afterAll(async () => {
    await db.close();
  });

  test('a secret is stored encrypted, listed without its value, replaced and deleted', async () => {
    const projectId = await newProject();
    const { id } = value(await new CreateSecretHandler().handle({ projectId, name: 'db-password', value: 's3cr3t' }, ctx));

    const [row] = await db.query<{ ciphertext: Uint8Array; key_version: string }>('SELECT ciphertext, key_version FROM secrets WHERE id = $1', [id]);
    expect(row!.key_version).toBe('test');
    expect(Buffer.from(row!.ciphertext).toString()).not.toContain('s3cr3t');
    const stored = (await new SecretRepository(db, ctx.orgId).findById(id))!;
    expect(await keyring.decrypt(stored, stored.id, stored.name)).toBe('s3cr3t');

    const listed = value(await new ListSecretsHandler().handle({ projectId }, ctx)).items;
    expect(Object.keys(listed[0]!).sort()).toEqual(['createdAt', 'id', 'name', 'projectId', 'updatedAt', 'updatedBy']);

    value(await new SetSecretValueHandler().handle({ id, value: 'other' }, ctx));
    const replaced = (await new SecretRepository(db, ctx.orgId).findById(id))!;
    expect(await keyring.decrypt(replaced, replaced.id, replaced.name)).toBe('other');

    expect(await new DeleteSecretHandler().handle({ id }, ctx)).toEqual({ ok: true, value: { id } });
    expect(await secretNames(projectId)).toEqual([]);
  });

  test('secret names: the shared rule, unique ignoring case; value required', async () => {
    const projectId = await newProject();
    value(await new CreateSecretHandler().handle({ projectId, name: 'Token', value: 'x' }, ctx));

    expect(await new CreateSecretHandler().handle({ projectId, name: 'token', value: 'y' }, ctx)).toMatchObject({
      ok: false,
      error: { code: 'conflict', fields: { name: 'Already in use' } },
    });
    expect(await new CreateSecretHandler().handle({ projectId, name: '1-bad', value: '' }, ctx)).toMatchObject({
      ok: false,
      error: { code: 'validation', fields: { value: 'Required' } },
    });
  });

  test('variables: values shown, editable, same name as a secret allowed', async () => {
    const projectId = await newProject();
    value(await new CreateSecretHandler().handle({ projectId, name: 'region', value: 'secret' }, ctx));
    const { id } = value(await new CreateVariableHandler().handle({ projectId, name: 'region', value: 'eu-west-1' }, ctx));

    expect(value(await new ListVariablesHandler().handle({ projectId }, ctx)).items).toMatchObject([{ id, name: 'region', value: 'eu-west-1' }]);
    expect(await new CreateVariableHandler().handle({ projectId, name: 'REGION', value: '' }, ctx)).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(await new UpdateVariableHandler().handle({ id, value: '' }, ctx)).toMatchObject({ ok: true, value: { value: '' } });
    expect(await new UpdateVariableHandler().handle({ id, value: 'x'.repeat(10_001) }, ctx)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await new DeleteVariableHandler().handle({ id }, ctx)).toEqual({ ok: true, value: { id } });
  });

  test('a connection and the secrets typed in its form are saved together, or not at all', async () => {
    const projectId = await newProject();
    const fields = { name: 'Orders', type: 'postgresql', config: { host: 'db', port: '5432', database: 'orders', user: 'app', password: 'pg-pass' } };

    // invalid profile (no host): neither the profile nor its new secret
    expect(await new CreateConnectionHandler().handle({ projectId, ...fields, config: { ...fields.config, host: '' }, newSecrets: [{ name: 'pg-pass', value: 'p' }] }, ctx))
      .toMatchObject({ ok: false, error: { fields: { host: 'Required' } } });
    expect(await secretNames(projectId)).toEqual([]);

    // a secret name that is not there and not new
    expect(await new CreateConnectionHandler().handle({ projectId, ...fields }, ctx)).toMatchObject({ ok: false, error: { fields: { password: 'Unknown secret' } } });

    const { id } = value(await new CreateConnectionHandler().handle({ projectId, ...fields, newSecrets: [{ name: 'pg-pass', value: 'p' }] }, ctx));
    expect(await secretNames(projectId)).toEqual(['pg-pass']);
    expect(value(await new ListConnectionsHandler().handle({ projectId }, ctx)).items).toMatchObject([{ id, name: 'Orders', type: 'postgresql', config: fields.config }]);

    // a name in use: conflict, and the new secret of that attempt is not created
    expect(await new CreateConnectionHandler().handle({ projectId, ...fields, name: 'orders', config: { ...fields.config, password: 'other' }, newSecrets: [{ name: 'other', value: 'o' }] }, ctx))
      .toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(await secretNames(projectId)).toEqual(['pg-pass']);

    // a new secret whose name exists: error on the field that names it
    expect(await new UpdateConnectionHandler().handle({ id, ...fields, newSecrets: [{ name: 'pg-pass', value: 'x' }] }, ctx))
      .toMatchObject({ ok: false, error: { fields: { password: 'Secret pg-pass: Already in use' } } });

    expect(await new UpdateConnectionHandler().handle({ id, ...fields, config: { ...fields.config, user: 'reader' } }, ctx)).toMatchObject({ ok: true, value: { config: { user: 'reader' } } });
    expect(await new TestConnectionHandler().handle({ id }, ctx)).toMatchObject({ ok: true });
    expect(await new DeleteConnectionHandler().handle({ id }, ctx)).toEqual({ ok: true, value: { id } });
    expect(await secretNames(projectId)).toEqual(['pg-pass']);
  });

  test('unknown types and options are refused; test reports a secret that is gone', async () => {
    const projectId = await newProject();
    expect(await new CreateConnectionHandler().handle({ projectId, name: 'X', type: 'ftp', config: {} }, ctx)).toMatchObject({ ok: false, error: { fields: { type: 'Unknown type' } } });
    expect(await new CreateConnectionHandler().handle({ projectId, name: 'X', type: 'http-client', config: { auth: 'magic' } }, ctx)).toMatchObject({
      ok: false,
      error: { fields: { auth: 'Not an option' } },
    });

    const { id: secretId } = value(await new CreateSecretHandler().handle({ projectId, name: 'api-token', value: 't' }, ctx));
    const { id } = value(await new CreateConnectionHandler().handle({ projectId, name: 'Api', type: 'http-client', config: { auth: 'bearer', token: 'api-token' } }, ctx));
    value(await new DeleteSecretHandler().handle({ id: secretId }, ctx));
    expect(await new TestConnectionHandler().handle({ id }, ctx)).toMatchObject({ ok: false, error: { message: 'Incomplete: token: Unknown secret.' } });
  });

  test('another organization sees and changes nothing', async () => {
    const projectId = await newProject();
    const { id: secretId } = value(await new CreateSecretHandler().handle({ projectId, name: 'mine', value: 'x' }, ctx));
    const { id: variableId } = value(await new CreateVariableHandler().handle({ projectId, name: 'mine', value: 'x' }, ctx));

    expect(await new ListSecretsHandler().handle({ projectId }, otherOrgCtx)).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(await new SetSecretValueHandler().handle({ id: secretId, value: 'theirs' }, otherOrgCtx)).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(await new DeleteVariableHandler().handle({ id: variableId }, otherOrgCtx)).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(await new CreateSecretHandler().handle({ projectId, name: 'theirs', value: 'x' }, otherOrgCtx)).toMatchObject({ ok: false, error: { code: 'not-found' } });
  });
});
