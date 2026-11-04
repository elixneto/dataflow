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

test('an HTTP request takes any API connection: basic (user and password), OAuth 2.0 (client credentials)', async () => {
  const {API_CONNECTION_TYPES, componentSettings} = await import('../../src/index');
  expect(componentSettings('http-request').find(f => f.key === 'connection')?.connectionTypes).toEqual(API_CONNECTION_TYPES);
  const profiles = {
    basic: {name: 'Basic', type: 'rest-basic', config: {user: 'joão', password: 'PW'}},
    oauth: {name: 'WF', type: 'rest-oauth2', config: {grant: 'clientCredentials', tokenUrl: 'https://auth.test/token', clientId: 'app', clientSecret: 'CS', scopes: 'read'}},
    erp: {name: 'ERP', type: 'sqlserver', config: SQL},
  };
  const basic = resolveConnection('http-client', {profile: 'basic'}, profiles, {PW: 'p@ss'}, API_CONNECTION_TYPES);
  expect(connectionHeaders(basic)).toEqual({Authorization: `Basic ${Buffer.from('joão:p@ss').toString('base64')}`});
  expect(() => resolveConnection('http-client', {profile: 'erp'}, profiles, {}, API_CONNECTION_TYPES))
    .toThrow('The connection "ERP" is not a HTTP Client Account or REST Basic Authentication or REST OAuth 2.0 connection.');
});

test('an OAuth 2.0 connection in a run: the token is asked once (form-encoded client credentials), sent as Bearer, hidden in logs', async () => {
  const sent: {url: string; headers: Record<string, string>; body?: string}[] = [];
  const wf: ExecutableFlow = {
    project: 'Test', flow: 'OAuth', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'h', type: 'http-request', label: 'Get', config: {connection: 'wf', url: {value: 'https://api.test/items', expression: false}, onError: 'continue'}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'h', targetPort: 'in-0'},
      {source: 'h', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  };
  const r = await flowRunner(wf, {
    mode: 'execution', id: 'oauth', evaluate, input: [{a: 1}, {a: 2}],
    secrets: {WF_SECRET: 's3cret'},
    connections: {wf: {name: 'WF', type: 'rest-oauth2', config: {grant: 'clientCredentials', tokenUrl: 'https://auth.test/token', clientId: 'app', clientSecret: 'WF_SECRET', scopes: 'read write'}}},
    http: async request => {
      sent.push({url: request.url, headers: request.headers, body: request.body});
      if (request.url === 'https://auth.test/token') return {status: 200, headers: {'content-type': 'application/json'} as Record<string, string>, body: JSON.stringify({access_token: 'tok-abcdef', expires_in: 3600})};
      return {status: 500, headers: {} as Record<string, string>, body: `token was ${request.headers.Authorization}`};
    },
  });
  const tokenCalls = sent.filter(s => s.url === 'https://auth.test/token');
  expect(tokenCalls).toHaveLength(1);
  expect(new URLSearchParams(tokenCalls[0]!.body)).toEqual(new URLSearchParams({grant_type: 'client_credentials', client_id: 'app', client_secret: 's3cret', scope: 'read write'}));
  expect(sent.filter(s => s.url === 'https://api.test/items').map(s => s.headers.Authorization)).toEqual(['Bearer tok-abcdef', 'Bearer tok-abcdef']);
  // the API answered 500 with the token in its body: nothing in the run's record shows it
  expect(JSON.stringify(r)).toContain('***');
  expect(JSON.stringify(r)).not.toContain('tok-abcdef');
});

test("a token request the provider refuses says the provider's reason (error, error_description)", async () => {
  const {oauthToken} = await import('../../src/index');
  const connection = {type: 'rest-oauth2' as const, config: {grant: 'clientCredentials', tokenUrl: 'https://ims.test/token', clientId: 'app'}, secrets: {clientSecret: 's'}};
  await expect(oauthToken(connection, async () => ({status: 400, body: JSON.stringify({error: 'invalid_scope', error_description: 'scope is required'})})))
    .rejects.toThrow('The OAuth 2.0 token request to https://ims.test/token failed (HTTP 400): invalid_scope: scope is required.');
  await expect(oauthToken(connection, async () => ({status: 401, body: 'Unauthorized'}))).rejects.toThrow('failed (HTTP 401): Unauthorized.');
});

test("the OAuth 2.0 token request counts as the HTTP Request's waiting (an outside system), with the API call", async () => {
  const wf: ExecutableFlow = {
    project: 'Test', flow: 'Timing', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {}},
      {id: 'h', type: 'http-request', label: 'Get', config: {connection: 'wf', url: {value: 'https://api.test/items', expression: false}}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'h', targetPort: 'in-0'},
      {source: 'h', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  };
  const r = await flowRunner(wf, {
    mode: 'execution', id: 'timing', evaluate,
    secrets: {WF_SECRET: 's3cret'},
    connections: {wf: {name: 'WF', type: 'rest-oauth2', config: {grant: 'clientCredentials', tokenUrl: 'https://auth.test/token', clientId: 'app', clientSecret: 'WF_SECRET'}}},
    http: async request => {
      await new Promise(resolve => setTimeout(resolve, 150));
      return request.url === 'https://auth.test/token'
        ? {status: 200, headers: {} as Record<string, string>, body: JSON.stringify({access_token: 'tok-abcdef', expires_in: 3600})}
        : {status: 200, headers: {} as Record<string, string>, body: '{}'};
    },
  });
  const h = r.components.find(c => c.nodeId === 'h')!;
  // two calls of 150 ms: the token and the API, both waiting; the component itself barely works
  expect(h.waitingMs!).toBeGreaterThanOrEqual(280);
  expect(h.activeTimeMs!).toBeLessThan(100);
  expect(h.logs.some(l => /^OAuth 2\.0 token from https:\/\/auth\.test\/token in \d+ ms\.$/.test(l.message))).toBe(true);
});
