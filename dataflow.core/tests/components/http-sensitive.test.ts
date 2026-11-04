import {expect, test} from 'bun:test';
import {flowRunner, isSensitiveHeader, responseHeaders} from '../../src/index';
import type {ExecutableFlow, HttpRequest, HttpResponse, RunProgress} from '../../src/index';
import {evaluate} from '../helpers';

/** Start → HTTP Request (an OAuth 2.0 connection) → End: what a server answers with credentials in it. */
const flow = (config: Record<string, unknown> = {}): ExecutableFlow => ({
  project: 'Test', flow: 'Sensitive', parameters: [],
  nodes: [
    {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
    {id: 'h', type: 'http-request', label: 'Get', config: {connection: 'api', url: {value: 'https://api.test/items', expression: false}, ...config}},
    {id: 'end', type: 'end', label: 'End', config: {}},
  ],
  edges: [
    {source: 'start', sourcePort: 'out-0', target: 'h', targetPort: 'in-0'},
    {source: 'h', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
  ],
});

const SESSION = 'session-jwt-0123456789';
const TOKEN = 'oauth-access-tok-987654';

const run = (config: Record<string, unknown> = {}, onProgress?: (p: RunProgress) => void) =>
  flowRunner(flow(config), {
    mode: 'validation', id: 'sensitive', evaluate, input: [{id: 1}],
    secrets: {API_SECRET: 'client-s3cret'},
    connections: {api: {name: 'API', type: 'rest-oauth2', config: {grant: 'clientCredentials', tokenUrl: 'https://auth.test/token', clientId: 'app', clientSecret: 'API_SECRET'}}},
    onProgress,
    http: async (request: HttpRequest): Promise<HttpResponse> => {
      if (request.url === 'https://auth.test/token') return {status: 200, headers: {'content-type': 'application/json'}, body: JSON.stringify({access_token: TOKEN, expires_in: 3600})};
      return {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'set-cookie': `app-auth=${SESSION}; Path=/; HttpOnly`,
          'authorization': `Bearer ${TOKEN}`,
          'x-session-id': 'abc-session',
          'x-request-id': 'req-42',
        },
        // a server that echoes the token it got
        body: JSON.stringify({items: [1, 2], seenToken: request.headers.Authorization}),
      };
    },
  });

test('which response headers carry credentials: cookies, auth, tokens, sessions, keys', () => {
  for (const name of ['set-cookie', 'Set-Cookie2', 'authorization', 'Proxy-Authenticate', 'WWW-Authenticate', 'x-amz-security-token', 'x-api-key', 'X-Session-Id', 'x-csrf-token']) {
    expect(isSensitiveHeader(name)).toBe(true);
  }

  for (const name of ['content-type', 'x-request-id', 'etag', 'location', 'cache-control']) expect(isSensitiveHeader(name)).toBe(false);
  const headers = {'set-cookie': 'a=b', 'content-type': 'text/plain'};
  expect(responseHeaders(headers)).toEqual({'set-cookie': '***', 'content-type': 'text/plain'});
  expect(responseHeaders(headers, 'none')).toEqual({});
  expect(responseHeaders(headers, 'all')).toEqual(headers);
});

test('a response with a session cookie and a token: hidden in the envelope, the samples, the progress and the record', async () => {
  const progress: string[] = [];
  const r = await run({}, p => progress.push(JSON.stringify(p)));
  expect(r.status).toBe('completed');
  const response = r.components.find(c => c.nodeId === 'h')!.outputSample['out-0']![0] as {response: {headers: Record<string, string>; body: {seenToken: string}}};
  // the header names stay, their values do not
  expect(response.response.headers).toEqual({'content-type': 'application/json', 'set-cookie': '***', 'authorization': '***', 'x-session-id': '***', 'x-request-id': 'req-42'});
  // the OAuth token the server echoed in its body: masked in the sample
  expect(response.response.body.seenToken).toBe('Bearer ***');

  for (const text of [JSON.stringify(r), ...progress]) {
    expect(text).not.toContain(SESSION);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('client-s3cret');
  }
});

test('Response headers: None leaves them out; All (unsafe) keeps them in the envelope, but never the run\'s own token', async () => {
  const none = await run({responseHeaders: 'none'});
  expect((none.components.find(c => c.nodeId === 'h')!.outputSample['out-0']![0] as {response: {headers: object}}).response.headers).toEqual({});

  const all = await run({responseHeaders: 'all'});
  const headers = (all.components.find(c => c.nodeId === 'h')!.outputSample['out-0']![0] as {response: {headers: Record<string, string>}}).response.headers;
  expect(headers['set-cookie']).toContain(SESSION);
  // the run's OAuth token is one of its secrets: masked wherever it shows
  expect(headers.authorization).toBe('Bearer ***');
});
