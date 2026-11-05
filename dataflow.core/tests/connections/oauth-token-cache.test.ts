import {beforeEach, expect, test} from 'bun:test';
import {cachedOAuthToken, flowRunner, forgetOAuthTokens, type ExecutableFlow, type HttpRequest, type HttpResponse, type RunOptions} from '../../src/index';
import {evaluate} from '../helpers';

/*
 * The OAuth 2.0 tokens in the runner's memory: one per connection, shared by every run of the process (a called flow,
 * the next run), asked again when the profile changes, renewed once when the API says 401.
 */

const TOKEN_URL = 'https://auth.test/token';
const API_URL = 'https://api.test/items';
const edge = (source: string, target: string) => ({source, sourcePort: 'out-0', target, targetPort: 'in-0'});

/** Start → HTTP Request (the `api` profile) → End */
const calling: ExecutableFlow = {
  id: 'B', project: 'Test', flow: 'Calls the API', parameters: [],
  nodes: [
    {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
    {id: 'h', type: 'http-request', label: 'Get', config: {connection: 'api', url: {value: API_URL, expression: false}}},
    {id: 'end', type: 'end', label: 'End', config: {}},
  ],
  edges: [edge('start', 'h'), edge('h', 'end')],
};

/** Start → a grid of `n` rows → Flow Invoker of B per row → End */
const parent = (n: number): ExecutableFlow => ({
  id: 'A', project: 'Test', flow: 'Parent', parameters: [],
  nodes: [
    {id: 'start', type: 'start', label: 'Start', config: {}},
    {id: 'g', type: 'datagrid', label: 'Rows', config: {columns: [{name: 'n', type: 'number'}], rows: Array.from({length: n}, (_, i) => [String(i)])}},
    {id: 'w', type: 'flow', label: 'Calls B', config: {flowId: 'B', sendEnvelope: true, onError: 'throw', parameters: []}},
    {id: 'end', type: 'end', label: 'End', config: {}},
  ],
  edges: [edge('start', 'g'), edge('g', 'w'), edge('w', 'end')],
});

/** a provider that hands out tok-1, tok-2... and an API that answers `api` (by default: 200 with the token it got) */
function server(api: (request: HttpRequest, tokens: number) => HttpResponse = r => ({status: 200, headers: {}, body: JSON.stringify({seen: r.headers.Authorization})})) {
  const sent: HttpRequest[] = [];
  let tokens = 0;
  const http = async (request: HttpRequest): Promise<HttpResponse> => {
    sent.push(request);
    if (request.url === TOKEN_URL) {
      tokens++;
      return {status: 200, headers: {'content-type': 'application/json'}, body: JSON.stringify({access_token: `tok-secret-${tokens}`, expires_in: 3600})};
    }
    return api(request, tokens);
  };
  return {http, sent, tokenCalls: () => sent.filter(r => r.url === TOKEN_URL).length, apiCalls: () => sent.filter(r => r.url === API_URL)};
}

const options = (http: RunOptions['http'], clientSecret = 'client-s3cret'): Partial<RunOptions> => ({
  mode: 'execution', evaluate, http,
  secrets: {API_SECRET: clientSecret},
  connections: {api: {name: 'Partner API', type: 'rest-oauth2', config: {grant: 'clientCredentials', tokenUrl: TOKEN_URL, clientId: 'app', clientSecret: 'API_SECRET'}}},
  flows: {B: calling},
});

const run = (flow: ExecutableFlow, extra: Partial<RunOptions>, id: string, input?: unknown[]) =>
  flowRunner(flow, {...extra, id, ...(input ? {input} : {})} as RunOptions);

beforeEach(() => forgetOAuthTokens());

test('a flow that calls another 20 times, the called one with an OAuth 2.0 HTTP Request: one token for all', async () => {
  const s = server();
  const r = await run(parent(20), options(s.http), 'tree');
  expect(r.status).toBe('completed');
  expect(s.apiCalls()).toHaveLength(20);
  expect(s.tokenCalls()).toBe(1);
  expect(new Set(s.apiCalls().map(c => c.headers.Authorization))).toEqual(new Set(['Bearer tok-secret-1']));
});

test('requests at the same time for a token not yet in memory: one request to the provider, all get its token', async () => {
  let asked = 0;
  const ask = async () => {
    asked++;
    await new Promise(resolve => setTimeout(resolve, 10));
    return {accessToken: 'tok-shared', expiresAt: Date.now() + 3_600_000};
  };
  const got = await Promise.all(Array.from({length: 50}, () => cachedOAuthToken('profile:p', 'f', ask)));
  expect(asked).toBe(1);
  expect(new Set(got.map(t => t.accessToken))).toEqual(new Set(['tok-shared']));
});

test('a request for a token that fails is not kept: the next one asks again', async () => {
  let asked = 0;
  const ask = async () => {
    asked++;
    if (asked === 1) throw new Error('provider down');
    return {accessToken: 'tok-ok', expiresAt: Date.now() + 3_600_000};
  };
  await expect(cachedOAuthToken('profile:p', 'f', ask)).rejects.toThrow('provider down');
  expect((await cachedOAuthToken('profile:p', 'f', ask)).accessToken).toBe('tok-ok');
  expect(asked).toBe(2);
});

test('the next run of the process takes the token in memory; a token about to expire is asked again before the request', async () => {
  const s = server();
  await run(calling, options(s.http), 'first', [{a: 1}]);
  await run(calling, options(s.http), 'second', [{a: 1}]);
  expect(s.tokenCalls()).toBe(1);

  let asked = 0;
  const ask = async () => ({accessToken: `tok-${++asked}`, expiresAt: 1_000_000});
  await cachedOAuthToken('profile:x', 'f', ask, () => 0);
  // 30 s before it ends it is no longer good
  expect((await cachedOAuthToken('profile:x', 'f', ask, () => 1_000_000 - 20_000)).accessToken).toBe('tok-2');
});

test('the profile changed (its client secret here): a new token, not the one asked with the old values', async () => {
  const s = server();
  await run(calling, options(s.http), 'before', [{a: 1}]);
  await run(calling, options(s.http, 'rotated-s3cret'), 'after', [{a: 1}]);
  expect(s.tokenCalls()).toBe(2);
  expect(s.apiCalls().map(c => c.headers.Authorization)).toEqual(['Bearer tok-secret-1', 'Bearer tok-secret-2']);
});

test('401 with the token in memory: a new token, the request sent once more and its answer kept', async () => {
  // the API takes only the newest token
  const s = server((r, tokens) =>
    r.headers.Authorization === `Bearer tok-secret-${tokens}` && tokens > 1 ? {status: 200, headers: {}, body: '{"ok":true}'} : {status: 401, headers: {}, body: 'expired'});
  const r = await run(calling, options(s.http), 'renewed', [{a: 1}]);
  expect(r.status).toBe('completed');
  expect(s.tokenCalls()).toBe(2);
  expect(s.apiCalls().map(c => c.headers.Authorization)).toEqual(['Bearer tok-secret-1', 'Bearer tok-secret-2']);
  // the new one stays in memory for the next run
  await run(calling, options(s.http), 'after', [{a: 1}]);
  expect(s.tokenCalls()).toBe(2);
});

test('401 again with the new token: the run fails naming the connection; no third try', async () => {
  const s = server(r => ({status: 401, headers: {}, body: `refused ${r.headers.Authorization}`}));
  const r = await run(calling, options(s.http), 'refused', [{a: 1}]);
  expect(r.status).toBe('failed');
  expect(JSON.stringify(r)).toContain('answered 401 (Unauthorized) again with a new OAuth 2.0 token of the connection \\"Partner API\\"');
  expect(s.apiCalls()).toHaveLength(2);
  expect(s.tokenCalls()).toBe(2);
});

test('a token from memory is hidden in the run that uses it, the one that got it and a later one alike', async () => {
  // the API echoes the token it got
  const s = server(r => ({status: 500, headers: {}, body: `token was ${r.headers.Authorization}`}));
  const first = await run(calling, options(s.http), 'got-it', [{a: 1}]);
  const later = await run(calling, options(s.http), 'from-memory', [{a: 1}]);
  expect(s.tokenCalls()).toBe(1);
  for (const r of [first, later]) {
    expect(JSON.stringify(r)).toContain('***');
    expect(JSON.stringify(r)).not.toContain('tok-secret-1');
  }
});

test('a run with its own token source (a worker asking its supervisor): asks it, gives back the refused token on a 401', async () => {
  const asked: {key: string; refused?: string}[] = [];
  const s = server(r => (r.headers.Authorization === 'Bearer from-source-2' ? {status: 200, headers: {}, body: '{}'} : {status: 401, headers: {}, body: 'no'}));
  const r = await run(calling, {
    ...options(s.http),
    oauthTokens: async request => {
      asked.push({key: request.key, ...(request.refused ? {refused: request.refused} : {})});
      return {accessToken: `from-source-${asked.length}`, expiresAt: Date.now() + 3_600_000};
    },
  }, 'sourced', [{a: 1}]);
  expect(r.status).toBe('completed');
  expect(asked).toEqual([{key: 'profile:api'}, {key: 'profile:api', refused: 'from-source-1'}]);
  // the provider itself is never called by the run: the source does it
  expect(s.tokenCalls()).toBe(0);
});
