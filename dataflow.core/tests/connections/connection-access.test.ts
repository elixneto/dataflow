import {expect, test} from 'bun:test';
import {
  COMPONENTS, connectionHeaders, connectionIssues, connectionSettings, connectionString, connectionUse, flowRunner, resolveConnection, settingVisible,
  type ExecutableFlow,
} from '../../src/index';
import {evaluate} from '../helpers';

const SQL = {host: 'db.example.com', port: '1433', database: 'crm', user: 'reader', password: 'ERP_PW', encrypt: 'on', trustServerCertificate: 'off'};
const PROFILES = {
  erp: {name: 'ERP', type: 'sqlserver', config: SQL},
  atlas: {name: 'Atlas', type: 'mongodb', config: {connectionString: 'ATLAS', database: 'crm'}},
  api: {name: 'API', type: 'http-client', config: {auth: 'bearer', token: 'API_TOKEN', headers: 'Accept: application/json'}},
};
const SECRETS = {ERP_CS: 'Server=erp;Database=crm', ERP_PW: 'pw;1', ATLAS: 'mongodb://atlas', API_TOKEN: 'tok-123', KEY: 'key-456'};

test('a component uses a profile (its id) or its own fields; without a profile the required ones are asked for', () => {
  expect(connectionUse('sqlserver', {connection: 'erp'})).toEqual({profile: 'erp'});
  expect(connectionUse('mongodb', {connectionString: 'ATLAS'})).toEqual({inline: {connectionString: 'ATLAS'}});
  expect(connectionIssues('sqlserver', {connection: 'erp'})).toEqual([]);
  expect(connectionIssues('sqlserver', {host: 'h'})).toEqual(['has no connection (choose one, or fill in database, user, password).']);
  expect(connectionIssues('sqlserver', SQL)).toEqual([]);
  // or a secret with the whole connection string
  expect(connectionIssues('sqlserver', {connectWith: 'string'})).toEqual(['has no connection (choose one, or fill in connection string).']);
  expect(connectionIssues('sqlserver', {connectWith: 'string', connectionString: 'ERP_CS'})).toEqual([]);
  // an API with no authentication needs nothing
  expect(connectionIssues('http-client', {})).toEqual([]);
  expect(connectionIssues('http-client', {auth: 'bearer'})).toEqual(['has no connection (choose one, or fill in token).']);
});

test('the inline fields show only without a profile (and with their own `when`)', () => {
  const fields = connectionSettings('http-client');
  const token = fields.find(f => f.key === 'token')!;
  expect(fields[0]).toMatchObject({key: 'connection', kind: 'connection', connectionType: 'http-client'});
  expect(settingVisible(token, {auth: 'bearer'}, fields)).toBe(true);
  expect(settingVisible(token, {auth: 'none'}, fields)).toBe(false);
  expect(settingVisible(token, {auth: 'bearer', connection: 'api'}, fields)).toBe(false);
  const sql = connectionSettings('sqlserver');
  const shown = (values: Record<string, unknown>) => sql.filter(f => settingVisible(f, values, sql)).map(f => f.key);
  expect(shown({})).toEqual(['connection', 'connectWith', 'host', 'port', 'database', 'user', 'password', 'encrypt', 'trustServerCertificate']);
  expect(shown({connectWith: 'string'})).toEqual(['connection', 'connectWith', 'connectionString']);
  expect(shown({connection: 'erp'})).toEqual(['connection']);
});

test('a profile and the same inline fields give the same connection string; secrets come from the runner', () => {
  const viaProfile = resolveConnection('sqlserver', {profile: 'erp'}, PROFILES, SECRETS);
  const inline = resolveConnection('sqlserver', connectionUse('sqlserver', SQL), PROFILES, SECRETS);
  expect(connectionString(viaProfile)).toBe('Server=db.example.com,1433;Database=crm;User Id=reader;Password={pw;1};Encrypt=true;TrustServerCertificate=false');
  expect(connectionString(inline)).toBe(connectionString(viaProfile));
  expect(connectionString(resolveConnection('sqlserver', connectionUse('sqlserver', {connectWith: 'string', connectionString: 'ERP_CS', host: 'ignored'}), PROFILES, SECRETS)))
    .toBe('Server=erp;Database=crm');
  expect(connectionString(resolveConnection('mongodb', {profile: 'atlas'}, PROFILES, SECRETS))).toBe('mongodb://atlas');
  expect(() => resolveConnection('sqlserver', {profile: 'nope'}, PROFILES, SECRETS)).toThrow('The connection "nope" does not exist in this runner.');
  expect(() => resolveConnection('mongodb', {profile: 'erp'}, PROFILES, SECRETS)).toThrow('The connection "ERP" is not a MongoDB connection.');
  expect(() => resolveConnection('sqlserver', {profile: 'erp'}, PROFILES, {})).toThrow('The secret "ERP_PW" does not exist in this runner.');
});

test("an API connection's headers: bearer or API key, and a profile's default headers", () => {
  expect(connectionHeaders(resolveConnection('http-client', {profile: 'api'}, PROFILES, SECRETS))).toEqual({Accept: 'application/json', Authorization: 'Bearer tok-123'});
  const inline = connectionUse('http-client', {auth: 'apiKey', apiKey: 'KEY'});
  expect(connectionHeaders(resolveConnection('http-client', inline, PROFILES, SECRETS))).toEqual({'X-API-Key': 'key-456'});
  expect(connectionHeaders(resolveConnection('http-client', connectionUse('http-client', {}), PROFILES, SECRETS))).toEqual({});
});

test('in a run: a MongoDB component with a profile takes its database; an HTTP request gets the auth header, the token masked in logs', async () => {
  const reads: unknown[] = [];
  const sent: Record<string, string>[] = [];
  const wf: ExecutableFlow = {
    project: 'Test', flow: 'Access', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {}},
      {id: 'm', type: 'mongodb-pipeline', label: 'Orders', config: {connection: 'atlas', collection: 'orders', pipeline: '[]'}},
      {id: 'h', type: 'http-request', label: 'Send', config: {connection: 'api', url: {value: 'https://api.example.com/x', expression: false}}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'm', targetPort: 'in-0'},
      {source: 'm', sourcePort: 'out-0', target: 'h', targetPort: 'in-0'},
      {source: 'h', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  };
  expect(COMPONENTS['mongodb-pipeline']?.validate(wf.nodes[1]!.config)).toEqual([]);
  const r = await flowRunner(wf, {
    mode: 'execution', id: 'access', evaluate, secrets: SECRETS, connections: PROFILES,
    documentQueries: {mongodb: async function* (q) { reads.push({connection: q.connection, database: q.database}); yield {_id: 1}; }},
    http: async request => {
      sent.push(request.headers);
      return {status: 401, headers: {}, body: `bad token ${request.headers.Authorization}`};
    },
  });
  expect(reads).toEqual([{connection: 'mongodb://atlas', database: 'crm'}]);
  expect(sent).toEqual([{Accept: 'application/json', Authorization: 'Bearer tok-123'}]);
  expect(r.status).toBe('failed');
  expect(r.error).not.toContain('tok-123');
});
