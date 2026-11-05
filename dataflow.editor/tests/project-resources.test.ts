import { describe, expect, test } from 'bun:test';
import { validateProfile } from '../src/data/connections/connection-profile';
import { CONNECTION_TYPES, defaultConfig, typesByGroup, visibleFields } from '../src/data/connections/connection-types';
import * as filesApi from '../src/data/files/mock-files-api';
import { allFolders, contentsOf, humanSize, nameError, type FilesListing } from '../src/data/files/project-file';
import { secretNameError } from '../src/data/secrets/secret';

const value = <T,>(result: { ok: true; value: T } | { ok: false }): T => {
  if (!result.ok) {
    throw new Error('expected success');
  }

  return result.value;
};

describe('secrets', () => {
  test('names: a letter first, then letters, digits, - and _ (ASCII); unique ignoring case', () => {
    for (const name of ['apiKey', 'API_KEY', 'db-pass2']) {
      expect(secretNameError(name, [])).toBeUndefined();
    }

    for (const name of ['1key', '_key', '-key', 'chave-ção', 'my key', 'a.b', 'a'.repeat(65)]) {
      expect(secretNameError(name, [])).toContain('Start with a letter');
    }

    expect(secretNameError('', [])).toBe('Required');
    expect(secretNameError('Token', [{ name: 'token' }])).toBe('Already in use');
  });
});

describe('connection profiles', () => {
  test('API profiles hold the credentials, not the URL (that is set where a flow calls the API)', () => {
    for (const type of ['rest-basic', 'rest-oauth2', 'http-client', 'soap'] as const) {
      const keys = visibleFields(type, defaultConfig(type)).map(f => f.key);
      expect(keys).not.toContain('baseUrl');
      expect(keys).not.toContain('wsdlUrl');
    }
  });

  test('every type is in one of the four groups, shown in order', () => {
    const groups = typesByGroup();

    expect(groups.map(g => g.label)).toEqual(['APIs', 'Storage', 'Databases', 'Messaging']);
    expect(groups.flatMap(g => g.types).length).toBe(CONNECTION_TYPES.length);
    expect(groups.find(g => g.group === 'database')!.types.map(t => t.label)).toContain('Amazon Redshift');
    expect(typesByGroup('azure').flatMap(g => g.types.map(t => t.label))).toEqual(['Azure Blob Storage', 'Azure Service Bus']);
  });

  test('every sensitive field is a secret field', () => {
    const sensitive = new Set([
      'password',
      'clientSecret',
      'token',
      'apiKey',
      'secretAccessKey',
      'connectionString',
      'accountKey',
      'sasToken',
      'serviceAccountKey',
      'privateKey',
      'key',
    ]);
    for (const type of CONNECTION_TYPES) {
      for (const field of type.fields.filter(f => sensitive.has(f.key))) {
        expect(`${type.type}.${field.key}:${field.kind}`).toBe(`${type.type}.${field.key}:secret`);
      }
    }
  });

  test('OAuth 2.0: Authorization code is shown as (soon), not selectable; Client credentials is the default', () => {
    const grant = visibleFields('rest-oauth2', {}).find(f => f.key === 'grant')!;
    expect(grant.default).toBe('clientCredentials');
    expect(grant.options).toEqual([
      { value: 'clientCredentials', label: 'Client credentials' },
      { value: 'authorizationCode', label: 'Authorization code (soon)', disabled: true },
    ]);
    // with Client credentials (what can be picked) the Authorization URL never shows
    expect(visibleFields('rest-oauth2', defaultConfig('rest-oauth2')).map(f => f.key)).not.toContain('authorizeUrl');
  });

  test('the fields that apply follow the selects', () => {
    expect(visibleFields('http-client', { auth: 'none' }).map(f => f.key)).toEqual(['auth', 'headers', 'timeout']);
    expect(visibleFields('http-client', { auth: 'bearer' }).map(f => f.key)).toContain('token');
    expect(visibleFields('rest-oauth2', { grant: 'clientCredentials' }).map(f => f.key)).not.toContain('authorizeUrl');
    expect(visibleFields('rest-oauth2', { grant: 'authorizationCode' }).map(f => f.key)).toContain('authorizeUrl');
    expect(visibleFields('azure-blob', { auth: 'sas' }).map(f => f.key)).toEqual(['auth', 'account', 'sasToken', 'container']);
    expect(visibleFields('kafka', { security: 'PLAINTEXT' }).map(f => f.key)).toEqual(['bootstrapServers', 'security', 'clientId']);
    expect(defaultConfig('postgresql')).toEqual({ port: '5432' });
    expect(defaultConfig('redshift')).toEqual({ port: '5439', ssl: 'on' });
  });

  test('conditional fields are required only when they apply', () => {
    const azure = { name: 'Blob', type: 'azure-blob' as const, config: { auth: 'accountKey', container: 'in' } };
    expect(validateProfile(azure, [], []).errors).toEqual({ account: 'Required', accountKey: 'Choose a secret' });

    const kafka = { name: 'Events', type: 'kafka' as const, config: { bootstrapServers: 'b:9092', security: 'SASL_SSL', mechanism: 'PLAIN' } };
    expect(validateProfile(kafka, [], []).errors).toEqual({ user: 'Required', password: 'Choose a secret' });
    expect(validateProfile({ ...kafka, config: { ...kafka.config, security: 'SSL' } }, [], []).errors).toEqual({});
  });

  test('required fields, numbers, and sensitive fields must name a project secret', () => {
    const fields = { name: 'Orders', type: 'postgresql' as const, config: { host: 'db', port: 'x', database: 'orders', user: '', password: 'MISSING' } };

    expect(validateProfile(fields, [], ['db-password']).errors).toEqual({ port: 'A whole number', user: 'Required', password: 'Unknown secret' });
    expect(validateProfile({ ...fields, config: { ...fields.config, port: '5432', user: 'app', password: '' } }, [], []).errors).toEqual({
      password: 'Choose a secret',
    });
    expect(validateProfile({ ...fields, name: 'orders' }, [{ id: 'o', name: 'Orders' }], []).errors.name).toBe('Already in use');
  });

  test('a select left out (saved before it existed) takes its default', () => {
    const fields = { name: 'Orders', type: 'sqlserver' as const, config: { host: 'db', port: '1433', database: 'orders', user: 'app', password: 'p' } };
    const { value, errors } = validateProfile(fields, [], ['p']);

    expect(errors).toEqual({});
    expect(value.config).toMatchObject({ encrypt: 'on', trustServerCertificate: 'off' });
  });

  test('fields that do not apply are dropped from the saved config', () => {
    const fields = { name: 'Api', type: 'http-client' as const, config: { auth: 'none', token: 'LEFTOVER' } };

    expect(validateProfile(fields, [], []).value.config).toEqual({ auth: 'none', headers: '', timeout: '' });
  });
});

describe('files', () => {
  const listing: FilesListing = {
    folders: ['inbox'],
    files: [
      { path: 'reports/2026/sales.csv', size: 10, contentType: 'text/csv', createdAt: new Date(), createdBy: 'ana', source: 'upload' },
      { path: 'readme.txt', size: 1, contentType: 'text/plain', createdAt: new Date(), createdBy: 'ana', source: 'upload' },
    ],
  };

  test('folders come from paths (and created ones); a folder lists its folders and files', () => {
    expect(allFolders(listing).sort()).toEqual(['inbox', 'reports', 'reports/2026']);
    expect(contentsOf(listing, '')).toMatchObject({ folders: ['inbox', 'reports'], files: [{ path: 'readme.txt' }] });
    expect(contentsOf(listing, 'reports/2026').files.map(f => f.path)).toEqual(['reports/2026/sales.csv']);
  });

  test('names: required, no slashes, not . or ..', () => {
    expect(nameError('report.csv')).toBeUndefined();
    expect(nameError(' ')).toBe('Required');
    expect(nameError('a/b')).toBe('No "/" or "\\"');
    expect(nameError('..')).toBe('Not a valid name');
  });

  test('sizes read by people', () => {
    expect(humanSize(812)).toBe('812 B');
    expect(humanSize(1536)).toBe('1.5 KB');
    expect(humanSize(1_204_331)).toBe('1.1 MB');
  });

  test('upload into a folder (same name replaces), new folder, delete', async () => {
    const projectId = crypto.randomUUID();
    value(await filesApi.uploadFiles(projectId, 'partners', [{ name: 'prices.csv', size: 5, type: 'text/csv' }]));
    let stored = value(await filesApi.listFiles(projectId));
    expect(stored.files.filter(f => f.path === 'partners/prices.csv').map(f => f.size)).toEqual([5]);

    expect(await filesApi.uploadFiles(projectId, 'missing', [{ name: 'x.txt', size: 1, type: '' }])).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(await filesApi.createFileFolder(projectId, 'partners', 'prices.csv')).toMatchObject({ ok: false, error: { code: 'conflict' } });
    value(await filesApi.createFileFolder(projectId, 'partners', 'archive'));

    value(await filesApi.deleteFileFolder(projectId, 'partners'));
    stored = value(await filesApi.listFiles(projectId));
    expect(allFolders(stored).some(f => f.startsWith('partners'))).toBe(false);
    expect(stored.files.some(f => typeof f.source === 'object')).toBe(true);
  });
});
