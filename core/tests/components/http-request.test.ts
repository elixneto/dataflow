import {expect, test} from 'bun:test';
import {COMPONENTS, workflowRunner, writesOutside} from '../../src/index';
import type {ExecutableWorkflow, HttpRequest, HttpResponse} from '../../src/index';
import {evaluate} from '../helpers';

/** Data Grid (3 setores) → HTTP Request → End. */
const flow = (config: Record<string, unknown>): ExecutableWorkflow => ({
  project: 'Test', workflow: 'HTTP', parameters: [{name: 'grupoId', type: 'text', default: 'g-1'}],
  nodes: [
    {id: 'start', type: 'start', label: 'Start', config: {}},
    {id: 'grid', type: 'datagrid', label: 'Setores', override: true, config: {columns: [{name: 'id', type: 'number'}, {name: 'nome', type: 'text'}],
      rows: [['1', 'Produção'], ['2', 'Área limpa'], ['3', 'Administrativo']]}},
    {id: 'http', type: 'http-request', label: 'GRO', outputKey: 'response', config: {onError: 'continue', ...config}},
    {id: 'end', type: 'end', label: 'End', config: {}},
  ],
  edges: [
    {source: 'start', sourcePort: 'out-0', target: 'grid', targetPort: 'in-0'},
    {source: 'grid', sourcePort: 'out-0', target: 'http', targetPort: 'in-0'},
    {source: 'http', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
  ],
});

const json = (status: number, value: unknown): HttpResponse => ({status, headers: {'content-type': 'application/json; charset=utf-8'}, body: JSON.stringify(value)});

/** A fake server: records the requests and answers what `answer` says (after `delay` ms). */
function fakeHttp(answer: (r: HttpRequest) => HttpResponse = r => json(201, {id: `novo-${r.body ? JSON.parse(r.body).nome : ''}`}), delay: (r: HttpRequest) => number = () => 5) {
  const requests: Omit<HttpRequest, 'signal'>[] = [];
  const send = async ({signal: _signal, ...r}: HttpRequest) => {
    requests.push(r);
    await new Promise(resolve => setTimeout(resolve, delay({...r, signal: _signal})));
    return answer({...r, signal: _signal});
  };
  return {requests, send};
}

const POST_SETOR = {
  method: 'POST',
  url: {value: '$SECRETS.GRO_URL + "/setores"', expression: true},
  headers: [{name: 'Authorization', value: "'Bearer ' + $SECRETS.GRO_TOKEN", expression: true}],
  query: [{name: 'origem', value: 'infofisio', expression: false}],
  body: {value: '({grupoId: $PARAMETERS.grupoId, nome: $nome})', expression: true},
};
const SECRETS = {GRO_URL: 'https://gro.example.com/api', GRO_TOKEN: 'segredo-123456'};
const nodeOf = (r: Awaited<ReturnType<typeof workflowRunner>>) => r.components.find(c => c.nodeId === 'http')!;

test('HTTP Request validates and writes only with POST, PUT, PATCH and DELETE', () => {
  expect(COMPONENTS['http-request'].validate({url: {value: 'gro.example.com', expression: false}, headers: [{name: 'Bad Header', value: '', expression: false}]}))
    .toEqual(['has a URL that does not start with http:// or https://.', 'header "Bad Header" is not a valid header name.']);
  expect(writesOutside(COMPONENTS['http-request'], {method: 'GET'})).toBe(false);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(writesOutside(COMPONENTS['http-request'], {method})).toBe(true);
});

test('HTTP Request sends one request per envelope with the evaluated URL, query, headers and JSON body', async () => {
  const http = fakeHttp();
  const r = await workflowRunner(flow(POST_SETOR), {mode: 'execution', id: 'h1', evaluate, http: http.send, secrets: SECRETS});
  expect(r.status).toBe('completed');
  expect(http.requests[0]).toEqual({
    method: 'POST', url: 'https://gro.example.com/api/setores?origem=infofisio', timeoutMs: 30_000,
    headers: {'Authorization': 'Bearer segredo-123456', 'content-type': 'application/json'},
    body: '{"grupoId":"g-1","nome":"Produção"}',
  });
  const node = nodeOf(r);
  // the JSON answer is parsed into the output key
  expect(node.outputSample['out-0'][0]).toEqual({id: 1, nome: 'Produção', response: {
    status: 201, headers: {'content-type': 'application/json; charset=utf-8'}, body: {id: 'novo-Produção'},
  }});
  expect(node.logs.at(-1)?.message).toMatch(/^3 request\(s\): 2xx 3, 4xx 0, 5xx 0, errors 0, in \d+ ms\.$/);
  // per request at debug, and never a secret value
  expect(node.logs.filter(l => l.level === 'debug')).toHaveLength(3);
  expect(node.logs.some(l => l.message.includes('segredo-123456') || l.message.includes('gro.example.com/api'))).toBe(false);
  expect(node.waitingMs).toBeGreaterThan(0);
});

test('HTTP Request: a GET runs in a test run, a POST does not send and logs what it would', async () => {
  const http = fakeHttp(() => ({status: 200, headers: {'content-type': 'text/plain'}, body: 'pong'}));
  const get = await workflowRunner(flow({method: 'GET', url: {value: 'https://example.com/ping', expression: false}}),
    {mode: 'validation', id: 'h2', evaluate, http: http.send});
  expect(http.requests).toHaveLength(3);
  // a text answer stays text
  expect(nodeOf(get).outputSample['out-0'][0].response).toEqual({status: 200, headers: {'content-type': 'text/plain'}, body: 'pong'});

  const post = await workflowRunner(flow(POST_SETOR), {mode: 'validation', id: 'h3', evaluate, http: http.send, secrets: SECRETS});
  expect(http.requests).toHaveLength(3);
  const node = nodeOf(post);
  expect(node.status).toBe('completed');
  // nothing sent, and the envelope goes on marked as such
  expect(node.outputSample['out-0'].map(d => d.response)).toEqual(Array(3).fill({notSent: true}));
  expect(node.logs.some(l => l.message === 'Test run: POST ***/setores?origem=infofisio not sent, body {"grupoId":"g-1","nome":"Produção"}.')).toBe(true);
  expect(node.logs.some(l => l.message.includes('segredo-123456'))).toBe(false);
});

test('HTTP Request: an error status goes to the error policy, or on to the output when Fail on non-2xx is off', async () => {
  const http = fakeHttp(r => (String(r.body).includes('Área') ? json(409, {erro: 'Setor já existe'}) : json(201, {id: 'x'})));
  const failing = await workflowRunner(flow(POST_SETOR), {mode: 'execution', id: 'h4', evaluate, http: http.send, secrets: SECRETS});
  const node = nodeOf(failing);
  expect(node.logs.filter(l => l.level === 'error').map(l => l.message)).toEqual(['HTTP 409 on POST ***/setores?origem=infofisio: {"erro":"Setor já existe"}']);
  expect(node.logs.at(-1)?.message).toMatch(/^3 request\(s\): 2xx 2, 4xx 1, 5xx 0, errors 0, in \d+ ms\.$/);

  const passing = await workflowRunner(flow({...POST_SETOR, failOnError: false}), {mode: 'execution', id: 'h5', evaluate, http: http.send, secrets: SECRETS});
  expect(nodeOf(passing).outputSample['out-0'][1].response).toEqual({status: 409, headers: {'content-type': 'application/json; charset=utf-8'}, body: {erro: 'Setor já existe'}});
});

test('HTTP Request keeps the arrival order with several requests at once', async () => {
  // the first one answers last
  const http = fakeHttp(r => json(200, {nome: JSON.parse(String(r.body)).nome}), r => (String(r.body).includes('Produção') ? 40 : 5));
  const r = await workflowRunner(flow({...POST_SETOR, concurrency: 3}), {mode: 'execution', id: 'h6', evaluate, http: http.send, secrets: SECRETS});
  expect(nodeOf(r).outputSample['out-0'].map(d => (d.response as {body: {nome: string}}).body.nome)).toEqual(['Produção', 'Área limpa', 'Administrativo']);
});

test('HTTP Request: no answer (timeout, network) is an error of the envelope, with the secrets hidden', async () => {
  const send = async () => {
    throw new Error('No answer in 30 s (timeout) from https://gro.example.com/api/setores');
  };
  const r = await workflowRunner(flow(POST_SETOR), {mode: 'execution', id: 'h7', evaluate, http: send, secrets: SECRETS});
  const node = nodeOf(r);
  expect(node.logs.filter(l => l.level === 'error').map(l => l.message)).toEqual(Array(3).fill('No answer in 30 s (timeout) from ***/setores'));
  expect(node.logs.at(-1)?.message).toMatch(/errors 3/);
});
