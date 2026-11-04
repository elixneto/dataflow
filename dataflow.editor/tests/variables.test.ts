import { afterEach, describe, expect, test } from 'bun:test';
import * as connectionsApi from '../src/data/connections/connections-api';
import * as secretsApi from '../src/data/secrets/secrets-api';
import * as variablesApi from '../src/data/variables/variables-api';
import { variableNameError, variableValueError } from '../src/data/variables/variable';

describe('variable rules', () => {
  test('names follow the secrets rule, unique among the variables ignoring case', () => {
    expect(variableNameError('base-url', [])).toBeUndefined();
    expect(variableNameError('1url', [])).toContain('Start with a letter');
    expect(variableNameError('Base-Url', [{ name: 'base-url' }])).toBe('Already in use');
  });

  test('a value may be empty, not longer than 10,000 characters', () => {
    expect(variableValueError('')).toBeUndefined();
    expect(variableValueError('x'.repeat(10_001))).toBe('At most 10000 characters');
  });
});

describe('secrets, variables and connections api', () => {
  const realFetch = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];

  const answer = (status: number, body?: unknown) => {
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(body === undefined ? null : JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
  };

  afterEach(() => {
    globalThis.fetch = realFetch;
    calls.length = 0;
  });

  const dates = { createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z', updatedBy: 'ana' };
  const route = () => calls.map(c => `${c.init.method} ${c.url} ${c.init.body ?? ''}`.trim());

  test('secrets: names only in, a value only ever sent', async () => {
    answer(200, { items: [{ id: 's', projectId: 'p', name: 'token', ...dates }] });
    expect(await secretsApi.listSecrets('p')).toMatchObject({ ok: true, value: [{ name: 'token', updatedAt: new Date(dates.updatedAt) }] });

    answer(200, { id: 's', projectId: 'p', name: 'token', ...dates });
    await secretsApi.createSecret('p', { name: 'token', value: 'v' });
    await secretsApi.updateSecretValue('p', 's', 'v2');
    await secretsApi.deleteSecret('p', 's');

    expect(route()).toEqual([
      'GET /api/projects/p/secrets',
      'POST /api/projects/p/secrets {"name":"token","value":"v"}',
      'PUT /api/secrets/s/value {"value":"v2"}',
      'DELETE /api/secrets/s',
    ]);
  });

  test('variables: list with values, create, edit the value, delete', async () => {
    answer(200, { items: [{ id: 'v', projectId: 'p', name: 'region', value: 'eu', ...dates }] });
    expect(await variablesApi.listVariables('p')).toMatchObject({ ok: true, value: [{ name: 'region', value: 'eu' }] });

    answer(200, { id: 'v', projectId: 'p', name: 'region', value: 'us', ...dates });
    await variablesApi.createVariable('p', { name: 'region', value: 'eu' });
    expect(await variablesApi.updateVariable('p', 'v', 'us')).toMatchObject({ ok: true, value: { value: 'us' } });
    await variablesApi.deleteVariable('p', 'v');

    expect(route().slice(1)).toEqual([
      'POST /api/projects/p/variables {"name":"region","value":"eu"}',
      'PATCH /api/variables/v {"value":"us"}',
      'DELETE /api/variables/v',
    ]);
  });

  test('connections: the new secrets go with the profile; a field error comes back for the form', async () => {
    const fields = { name: 'Events', type: 'kafka' as const, config: { bootstrapServers: 'b:9092', security: 'SSL' } };
    answer(201, { id: 'c' });
    await connectionsApi.createConnectionWithSecrets('p', fields, [{ name: 'kafka-pass', value: 'k' }]);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ ...fields, newSecrets: [{ name: 'kafka-pass', value: 'k' }] });

    const error = { code: 'conflict', message: 'The request has invalid fields.', fields: { name: 'Already in use' } };
    answer(409, { error });
    expect(await connectionsApi.updateConnectionWithSecrets('p', 'c', fields)).toEqual({ ok: false, error });

    answer(200, { message: 'Complete', ms: 3 });
    await connectionsApi.testConnection('p', 'c');
    await connectionsApi.testConnectionDraft('p', fields, [{ name: 'kafka-pass', value: 'k' }]);
    await connectionsApi.deleteConnection('p', 'c');
    expect(route().slice(1)).toEqual([
      `PUT /api/connections/c ${JSON.stringify({ ...fields, newSecrets: [] })}`,
      'POST /api/connections/c/test',
      `POST /api/projects/p/connections/test ${JSON.stringify({ type: 'kafka', config: fields.config, newSecrets: [{ name: 'kafka-pass', value: 'k' }] })}`,
      'DELETE /api/connections/c',
    ]);
  });
});
