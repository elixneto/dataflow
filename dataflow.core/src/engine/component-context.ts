import {timed, timedRequests} from '#engine/stopwatch';
import {checkedCall, invokeFlow, queueFlow} from '#engine/invoke-flow';
import {envelopeVariables} from '#envelope/expression-variables';
import {toError} from '#errors/normalize-error';
import {API_CONNECTION_TYPES, connectionHeaders, connectionString, resolveConnection, type ConnectionUse} from '../connections/connection-access';
import {cachedAccessTokens, oauthFingerprint, oauthTokenFromMemory} from '../connections/oauth-token-cache';
import type {FlowExecution} from '#engine/flow-execution';
import type {ComponentContext} from '#types/component-context.type';
import type {ExecutableNode} from '#types/executable-node.type';

/** How many of the upserts a test run would send are written out in full in the log. */
const LOGGED_UPSERTS = 3;
/** How much of a request body a test run writes in the log. */
const BODY_EXCERPT = 300;

/** the OAuth 2.0 access tokens a run used (kept by its token source, see RunOptions.oauthTokens): hidden in its logs */
const runTokens = new WeakMap<object, Set<string>>();
const tokensOf = (options: object) => {
  let tokens = runTokens.get(options);
  if (!tokens) {
    tokens = new Set();
    runTokens.set(options, tokens);
  }
  return tokens;
};

/**
 * The values a run never shows (in a log, an error, a sample): its secrets and the OAuth 2.0 access tokens it got,
 * longest first (one that contains another is hidden whole).
 */
export const hiddenValues = (options: {secrets?: Record<string, string>}): string[] =>
  [...new Set([...Object.values(options.secrets ?? {}), ...tokensOf(options), ...cachedAccessTokens()])]
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
      const script = await options.prepareScript(code, {run, parameters, secrets: options.secrets ?? {}, variables: options.variables ?? {}, log: (m, level = 'info') => log(level, m), wait});
      // calling the script is this component's own work: its active time from here (see Stopwatch)
      return (input: unknown) => {
        stopwatch.resume();
        return script(input);
      };
    },
    fieldValue: (field, doc) => {
      if (!field.expression) return field.value;
      // evaluating is this component's own work: its active time from here, whoever ran just before (see Stopwatch)
      stopwatch.resume();
      return options.evaluate(field.value, envelopeVariables(doc, options.secrets, options.variables));
    },
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
    // handing it to the runner is waiting for an outside system, not this component's work
    queueFlow: async (flowId, call) => {
      stopwatch.stop();
      waiting.resume();
      try {
        return await queueFlow(execution, node, flowId, call);
      } finally {
        waiting.stop();
        stopwatch.resume();
      }
    },
    checkFlowCall: (flowId, input) => void checkedCall(execution, flowId, input),
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
        // an API connection: its headers first (an OAuth 2.0 token from the run's token source, see RunOptions.oauthTokens), the component's own win
        let request = given;
        let oauth: {name: string; renew: (refused?: string) => Promise<string>} | undefined;
        let token: string | undefined;
        if (auth) {
          const resolved = resolveConnection('http-client', auth, options.connections, options.secrets, API_CONNECTION_TYPES);
          if (resolved.type === 'rest-oauth2' && !dryRun) {
            const fingerprint = oauthFingerprint(resolved);
            const key = 'profile' in auth ? `profile:${auth.profile}` : `inline:${fingerprint}`;
            const name = 'profile' in auth ? (options.connections?.[auth.profile]?.name ?? auth.profile) : 'of the HTTP Request';
            const source = options.oauthTokens ?? (r => oauthTokenFromMemory(r, http, execution.control.signal));
            oauth = {
              name,
              // a token the API refused goes back with the ask: the next one comes (or the one another request already got)
              renew: async refused => {
                const got = await source({key, fingerprint, connection: resolved, timeoutMs: given.timeoutMs, ...(refused ? {refused} : {})});
                tokensOf(options).add(got.accessToken);
                if (got.askedMs !== undefined) log('debug', `OAuth 2.0 token from ${mask(resolved.config.tokenUrl ?? '')} in ${got.askedMs} ms.`);
                return got.accessToken;
              },
            };
            token = await oauth.renew();
          }
          request = {...given, headers: {...connectionHeaders(resolved, token), ...given.headers}};
        }
        if (dryRun) {
          const body = request.body === undefined ? '' : `, body ${mask(request.body.slice(0, BODY_EXCERPT))}${request.body.length > BODY_EXCERPT ? '…' : ''}`;
          log('info', `Test run: ${request.method} ${mask(request.url)} not sent${body}.`);
          return null;
        }
        const send = async (sent: typeof request) => {
          const t0 = performance.now();
          const response = await http({...sent, signal: execution.control.signal});
          log('debug', `${sent.method} ${mask(sent.url)} → ${response.status} in ${Math.round(performance.now() - t0)} ms.`);
          return response;
        };
        const response = await send(request);
        if (response.status !== 401 || !oauth || !token) return response;
        // 401 with an OAuth 2.0 token (expired early, revoked, the process's one from before): a new token, the request once more
        log('debug', `401 with the OAuth 2.0 token of the connection "${oauth.name}": asking a new one and sending again.`);
        const renewed = await oauth.renew(token);
        const again = await send({...request, headers: {...request.headers, Authorization: `Bearer ${renewed}`, ...given.headers}});
        if (again.status === 401) {
          throw new Error(`${request.method} ${request.url} answered 401 (Unauthorized) again with a new OAuth 2.0 token of the connection "${oauth.name}".`);
        }
        return again;
      } catch (e) {
        throw new Error(mask(toError(e).message));
      } finally {
        if (!dryRun && --inFlight === 0) waiting.stop();
      }
    },
    mask,
    holding: (envelopes, held) => {
      stopwatch.resume();
      execution.memoryOf(node.id).holding(envelopes, held);
    },
  };
}
