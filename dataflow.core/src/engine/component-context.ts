import {timed, timedRequests} from '#engine/stopwatch';
import {invokeFlow} from '#engine/invoke-flow';
import {envelopeVariables} from '#envelope/expression-variables';
import {toError} from '#errors/normalize-error';
import {API_CONNECTION_TYPES, connectionHeaders, connectionString, oauthToken, resolveConnection, tokenStillGood, type ConnectionUse, type OAuthToken} from '../connections/connection-access';
import type {FlowExecution} from '#engine/flow-execution';
import type {ComponentContext} from '#types/component-context.type';
import type {ExecutableNode} from '#types/executable-node.type';

/** How many of the upserts a test run would send are written out in full in the log. */
const LOGGED_UPSERTS = 3;
/** How much of a request body a test run writes in the log. */
const BODY_EXCERPT = 300;

/** the OAuth 2.0 tokens of a run, by connection: asked once, used until they expire */
const runTokens = new WeakMap<object, Map<string, OAuthToken>>();
const tokensOf = (options: object) => {
  let tokens = runTokens.get(options);
  if (!tokens) {
    tokens = new Map();
    runTokens.set(options, tokens);
  }
  return tokens;
};

/**
 * The values a run never shows (in a log, an error, a sample): its secrets and the OAuth 2.0 access tokens it got,
 * longest first (one that contains another is hidden whole).
 */
export const hiddenValues = (options: {secrets?: Record<string, string>}): string[] =>
  [...Object.values(options.secrets ?? {}), ...[...tokensOf(options).values()].map(t => t.accessToken)]
    .filter(v => v.length >= 4)
    .sort((a, b) => b.length - a.length);

/** `text` with every hidden value of the run replaced by *** */
export const maskText = (text: string, hidden: string[]) => hidden.reduce((t, secret) => t.split(secret).join('***'), text);

/**
 * What the engine gives a component while it runs (`ctx`): expressions, scripts, waits, database, memory...
 * `dryRun`: a target in a test run; its writes send nothing (see FlowExecution.runNode).
 */
export function componentContext(execution: FlowExecution, node: ExecutableNode, log: ComponentContext['log'], dryRun = false): ComponentContext {
  const {run, options, parameters} = execution;
  const stopwatch = execution.stopwatchOf(node.id);
  // runs only while waiting for an outside system: a pull of the next row, a write, the next envelope of a called flow
  const waiting = execution.waitingOf(node.id);
  let logged = 0;
  let inFlight = 0;
  // secret values never go to a log; an OAuth 2.0 access token is a secret too, once fetched
  const mask = (text: string) => maskText(text, hiddenValues(options));
  // a database connection: its connection string, and the database a component that sets none takes from it
  const database = (type: 'sqlserver' | 'mongodb', use: ConnectionUse) => {
    const resolved = resolveConnection(type, use, options.connections, options.secrets);
    return {connection: connectionString(resolved), database: resolved.config.database ?? ''};
  };
  return {
    run, node, log,
    prepareScript: async code => {
      if (!options.prepareScript) throw new Error('This runner does not execute scripts.');
      // what the script waits for outside (its fetch, its timers): Waiting, not Active; several at once count once
      let outside = 0;
      const wait = async <T>(promise: Promise<T>): Promise<T> => {
        if (outside++ === 0) {
          stopwatch.stop();
          waiting.resume();
        }
        try {
          return await promise;
        } finally {
          if (--outside === 0) {
            waiting.stop();
            stopwatch.resume();
          }
        }
      };
      return options.prepareScript(code, {run, parameters, secrets: options.secrets ?? {}, variables: options.variables ?? {}, log: m => log('info', m), wait});
    },
    fieldValue: (field, doc) => (field.expression
      ? options.evaluate(field.value, envelopeVariables(doc, options.secrets, options.variables))
      : field.value),
    wait: async promise => {
      stopwatch.stop();
      try {
        return await promise;
      } finally {
        stopwatch.resume();
      }
    },
    waitEach: source => timed(source, stopwatch),
    invokeFlow: (flowId, call) => {
      const called = invokeFlow(execution, node, flowId, call);
      return {...called, envelopes: timedRequests(called.envelopes, waiting)};
    },
    queryDatabase: (kind, {connection: use, ...query}) => {
      const driver = options.databases?.[kind];
      if (!driver) throw new Error(`This runner does not query ${kind}.`);
      const {connection} = database(kind, use);
      // only the pull of the next row: while the component is held by the next one (backpressure), it is not waiting here
      return timedRequests(driver({...query, connection, signal: execution.control.signal}), waiting);
    },
    aggregateDocuments: (kind, {connection: use, ...query}) => {
      const driver = options.documentQueries?.[kind];
      if (!driver) throw new Error(`This runner does not read from ${kind}.`);
      const {connection, database: fallback} = database(kind, use);
      // like queryDatabase: only the pull of the next document is waiting
      return timedRequests(driver({...query, database: query.database || fallback, connection, signal: execution.control.signal}), waiting);
    },
    upsertDocuments: async (kind, {connection: use, ...given}) => {
      const driver = options.documentStores?.[kind];
      if (!driver) throw new Error(`This runner does not write to ${kind}.`);
      const {connection, database: fallback} = database(kind, use);
      const batch = {...given, database: given.database || fallback};
      if (dryRun) {
        const target = `${batch.database}.${batch.collection}`;
        log('info', `Test run: ${batch.upserts.length} upsert(s) into ${target} not sent.`);
        for (const upsert of batch.upserts.slice(0, Math.max(0, LOGGED_UPSERTS - logged))) {
          logged += 1;
          log('info', `Would upsert into ${target}: filter ${JSON.stringify(upsert.filter)}, $set ${JSON.stringify(upsert.document)}`);
        }
        return null;
      }
      stopwatch.stop();
      try {
        waiting.resume();
        return await driver({...batch, connection, signal: execution.control.signal});
      } finally {
        waiting.stop();
        stopwatch.resume();
      }
    },
    deleteDocuments: async (kind, {connection: use, ...given}) => {
      const driver = options.documentDeletes?.[kind];
      if (!driver) throw new Error(`This runner does not delete from ${kind}.`);
      const {connection, database: fallback} = database(kind, use);
      const request = {...given, database: given.database || fallback};
      const target = `${request.database}.${request.collection}`;
      stopwatch.stop();
      waiting.resume();
      try {
        // a test run deletes nothing: it only counts what the filter matches (a read)
        const n = await driver({...request, connection, countOnly: dryRun, signal: execution.control.signal});
        if (!dryRun) return {deleted: n};
        log('info', `Test run: ${n} document(s) of ${target} match the filter ${JSON.stringify(request.filter)}; none deleted.`);
        return {notSent: true, matched: n};
      } finally {
        waiting.stop();
        stopwatch.resume();
      }
    },
    sendHttp: async ({auth, ...given}) => {
      if (!options.http) throw new Error('This runner does not send HTTP requests.');
      const http = options.http;
      // waiting (for an outside system) while at least one request is in flight, the OAuth 2.0 token's included
      if (!dryRun && inFlight++ === 0) waiting.resume();
      try {
        // an API connection: its headers first (an OAuth 2.0 token asked once per run and connection), the component's own win
        let request = given;
        if (auth) {
          const resolved = resolveConnection('http-client', auth, options.connections, options.secrets, API_CONNECTION_TYPES);
          let token: string | undefined;
          if (resolved.type === 'rest-oauth2' && !dryRun) {
            const key = 'profile' in auth ? auth.profile : JSON.stringify(resolved.config);
            const tokens = tokensOf(options);
            let cached = tokens.get(key);
            if (!tokenStillGood(cached)) {
              const t0 = performance.now();
              cached = await oauthToken(resolved, async r => http({...r, timeoutMs: request.timeoutMs, signal: execution.control.signal}));
              tokens.set(key, cached);
              log('debug', `OAuth 2.0 token from ${mask(resolved.config.tokenUrl ?? '')} in ${Math.round(performance.now() - t0)} ms.`);
            }
            token = cached.accessToken;
          }
          request = {...given, headers: {...connectionHeaders(resolved, token), ...given.headers}};
        }
        if (dryRun) {
          const body = request.body === undefined ? '' : `, body ${mask(request.body.slice(0, BODY_EXCERPT))}${request.body.length > BODY_EXCERPT ? '…' : ''}`;
          log('info', `Test run: ${request.method} ${mask(request.url)} not sent${body}.`);
          return null;
        }
        const t0 = performance.now();
        const response = await http({...request, signal: execution.control.signal});
        log('debug', `${request.method} ${mask(request.url)} → ${response.status} in ${Math.round(performance.now() - t0)} ms.`);
        return response;
      } catch (e) {
        throw new Error(mask(toError(e).message));
      } finally {
        if (!dryRun && --inFlight === 0) waiting.stop();
      }
    },
    mask,
    holding: (envelopes, held) => execution.memoryOf(node.id).holding(envelopes, held),
  };
}
