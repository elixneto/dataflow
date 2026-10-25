import {withKey} from '#envelope/envelope-data';
import {toError} from '#errors/normalize-error';
import type {ComponentLogic} from '#types/component-logic.type';
import type {Envelope} from '#types/envelope.type';
import type {ExpressionField} from '#types/expression-field.type';
import type {HttpResponse} from '#types/http-response.type';

/**
 * HTTP Request: one request per envelope (method, URL, query params, headers and body are expressions on it; $SECRETS
 * works, e.g. `'Bearer ' + $SECRETS.TOKEN`), and the envelope goes on with `{status, headers, body}` in its output key
 * (the body parsed when the response is JSON). With "Fail on non-2xx", an error status is an error of the envelope.
 * A GET only reads; POST, PUT, PATCH and DELETE write, so in a test run they send nothing (the engine's gate for
 * `sideEffects`, here a function of the method). Up to `concurrency` requests at once, the output in arrival order.
 * Secret values never reach the logs.
 */

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = typeof HTTP_METHODS[number];
export type HttpPair = ExpressionField & {name: string};

export const DEFAULT_HTTP_TIMEOUT_S = 30;
export const MAX_HTTP_CONCURRENCY = 20;
/** How much of an error response goes into the error message. */
const ERROR_EXCERPT = 300;

export function httpConfig(config: Record<string, unknown>) {
  const timeout = Math.round(Number(config.timeoutS ?? DEFAULT_HTTP_TIMEOUT_S));
  const concurrency = Math.round(Number(config.concurrency ?? 1));
  const field = (v: unknown, expression: boolean): ExpressionField => {
    const f = v as Partial<ExpressionField> | undefined;
    return {value: typeof f?.value === 'string' ? f.value : '', expression: typeof f?.expression === 'boolean' ? f.expression : expression};
  };
  return {
    method: (HTTP_METHODS.includes(config.method as HttpMethod) ? config.method : 'GET') as HttpMethod,
    url: field(config.url, false),
    query: Array.isArray(config.query) ? (config.query as HttpPair[]) : [],
    headers: Array.isArray(config.headers) ? (config.headers as HttpPair[]) : [],
    body: field(config.body, true),
    timeoutS: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_HTTP_TIMEOUT_S,
    concurrency: Number.isFinite(concurrency) ? Math.min(MAX_HTTP_CONCURRENCY, Math.max(1, concurrency)) : 1,
    failOnError: config.failOnError !== false,
  };
}

/** Whether the method writes (anything but a GET): a test run does not send it. */
export const httpWrites = (config: Record<string, unknown>) => httpConfig(config).method !== 'GET';

/** The body as the response's content type says: JSON parsed, anything else as text. */
function responseBody(response: HttpResponse): unknown {
  if (!/json/i.test(response.headers['content-type'] ?? '') || response.body === '') return response.body;
  try {
    return JSON.parse(response.body);
  } catch {
    return response.body;
  }
}

type Outcome = {doc: Envelope; error?: Error; response?: HttpResponse | null; request?: {method: string; url: string}};

export const httpRequest: ComponentLogic = {
  type: 'http-request',
  inputs: 1,
  outputs: 1,
  defaultOutputKey: 'response',
  sideEffects: httpWrites,

  validate(config) {
    const {url, query, headers} = httpConfig(config);
    const issues: string[] = [];
    if (!url.value.trim()) issues.push('has no URL.');
    else if (!url.expression && !/^https?:\/\//i.test(url.value.trim())) issues.push('has a URL that does not start with http:// or https://.');
    query.forEach((p, i) => p.name?.trim() || issues.push(`query param ${i + 1} has no name.`));
    headers.forEach((h, i) => {
      if (!h.name?.trim()) issues.push(`header ${i + 1} has no name.`);
      else if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(h.name.trim())) issues.push(`header "${h.name}" is not a valid header name.`);
    });
    return issues;
  },

  async* execute(inputs, config, ctx) {
    const {method, url, query, headers, body, timeoutS, concurrency, failOnError} = httpConfig(config);
    const key = ctx.node.outputKey || 'response';
    const counts = {ok: 0, client: 0, server: 0, other: 0, errors: 0, notSent: 0};
    const t0 = performance.now();

    /** builds and sends the request of an envelope; never rejects (an error is part of the outcome) */
    const send = async (doc: Envelope): Promise<Outcome> => {
      try {
        const value = (f: ExpressionField) => ctx.fieldValue(f, doc);
        let target = String(value(url) ?? '').trim();
        if (!/^https?:\/\//i.test(target)) throw new Error(`The URL "${ctx.mask(target)}" does not start with http:// or https://.`);
        const params = query.filter(p => p.name?.trim()).map(p => {
          const v = value(p);
          return `${encodeURIComponent(p.name.trim())}=${encodeURIComponent(v === undefined || v === null ? '' : String(v))}`;
        });
        if (params.length) target += (target.includes('?') ? '&' : '?') + params.join('&');
        const sentHeaders: Record<string, string> = {};
        for (const h of headers) if (h.name?.trim()) sentHeaders[h.name.trim()] = String(value(h) ?? '');
        let sentBody: string | undefined;
        if (method !== 'GET' && body.value.trim()) {
          const content = value(body);
          if (content !== undefined && content !== null) {
            if (typeof content === 'string') sentBody = content;
            else {
              sentBody = JSON.stringify(content);
              if (!Object.keys(sentHeaders).some(h => h.toLowerCase() === 'content-type')) sentHeaders['content-type'] = 'application/json';
            }
          }
        }
        const response = await ctx.sendHttp({method, url: target, headers: sentHeaders, body: sentBody, timeoutMs: timeoutS * 1000});
        return {doc, response, request: {method, url: target}};
      } catch (e) {
        return {doc, error: toError(e)};
      }
    };

    // up to `concurrency` in flight; they go out in the order they came in
    const pending: Promise<Outcome>[] = [];
    async function* settle(outcome: Promise<Outcome>) {
      // waiting for the answer is not active time
      const {doc, error, response, request} = await ctx.wait(outcome);
      if (error) {
        counts.errors += 1;
        yield {error, doc};
        return;
      }
      if (!response || !request) {
        counts.notSent += 1;
        return;
      }
      const s = response.status;
      if (s >= 200 && s < 300) counts.ok += 1;
      else if (s >= 400 && s < 500) counts.client += 1;
      else if (s >= 500) counts.server += 1;
      else counts.other += 1;
      if (failOnError && (s < 200 || s >= 300)) {
        const excerpt = response.body.length > ERROR_EXCERPT ? `${response.body.slice(0, ERROR_EXCERPT)}…` : response.body;
        yield {error: Object.assign(new Error(ctx.mask(`HTTP ${s} on ${request.method} ${request.url}${excerpt ? `: ${excerpt}` : ''}`)), {name: 'HttpError'}), doc};
        return;
      }
      yield {port: 'out-0', doc: withKey(doc, key, {status: s, headers: response.headers, body: responseBody(response)}, ctx.node.override)};
    }

    for await (const doc of inputs['in-0'] ?? []) {
      pending.push(send(doc));
      if (pending.length >= concurrency) yield* settle(pending.shift()!);
    }
    while (pending.length) yield* settle(pending.shift()!);

    const total = counts.ok + counts.client + counts.server + counts.other + counts.errors + counts.notSent;
    if (counts.notSent && counts.notSent === total) ctx.log('info', `${total} ${method} request(s) prepared, none sent (test run).`);
    else {
      ctx.log('info', `${total} request(s): 2xx ${counts.ok}, 4xx ${counts.client}, 5xx ${counts.server}${counts.other ? `, other ${counts.other}` : ''}, errors ${counts.errors}, in ${Math.round(performance.now() - t0)} ms.`);
    }
  },
};
