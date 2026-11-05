import {oauthToken, tokenStillGood, type OAuthToken, type ResolvedConnection} from './connection-access';
import type {SendHttp} from '#types/send-http.type';

/*
 * The OAuth 2.0 access tokens of a process, one per connection: a profile by its id, a connection filled in
 * the component itself by its fields. A token is asked once and used by every run of the process (a called flow, its
 * 500 envelopes, the next run) until it is about to expire; one asked for while another request for it is on its way
 * waits for that one (no rush of requests). Kept only in memory: never in the database, never in a log. Gone when the
 * process ends; the next request asks again. A run takes its tokens from a source (`RunOptions.oauthTokens`): by
 * default this memory, in the run's own process; a worker's runs ask their supervisor, which keeps them here, for
 * all its workers.
 */

/** what a run asks for a token with: the connection (`key`: its profile, or its fields), and the one the API refused, if any */
export type OAuthTokenRequest = {
  key: string;
  fingerprint: string;
  connection: ResolvedConnection;
  timeoutMs: number;
  /** the token the API answered 401 to: dropped, a new one asked (unless another request already got it) */
  refused?: string;
};

/** a token as a source gives it; `askedMs`: asked from the provider for this request, that long */
export type SourcedOAuthToken = OAuthToken & {askedMs?: number};

/** where a run's OAuth 2.0 tokens come from */
export type OAuthTokenSource = (request: OAuthTokenRequest) => Promise<SourcedOAuthToken>;

type Entry = {
  /** what the token was asked with: a profile edited or its secret changed asks a new one */
  fingerprint: string;
  /** the request on its way, or the token it got */
  token: Promise<OAuthToken>;
  /** the token, once got */
  value?: OAuthToken;
};

const entries = new Map<string, Entry>();

/** what a token depends on: its URL, client, scopes, audience, grant and the client secret's value */
export const oauthFingerprint = (connection: ResolvedConnection): string => {
  const {config, secrets} = connection;
  return JSON.stringify([config.tokenUrl ?? '', config.clientId ?? '', config.scopes ?? '', config.audience ?? '', config.grant ?? '', secrets.clientSecret ?? '']);
};

/**
 * The connection's token: the one in memory while it is good and asked with the same fingerprint, otherwise asked
 * with `ask` (once, whoever else needs it meanwhile waits for the same). A request that fails is not kept.
 */
export function cachedOAuthToken(key: string, fingerprint: string, ask: () => Promise<OAuthToken>, now = Date.now): Promise<OAuthToken> {
  const found = entries.get(key);
  if (found && found.fingerprint === fingerprint && (!found.value || tokenStillGood(found.value, now()))) return found.token;
  const entry: Entry = {fingerprint, token: Promise.resolve(undefined as never)};
  entry.token = ask().then(
    token => {
      entry.value = token;
      return token;
    },
    error => {
      if (entries.get(key) === entry) entries.delete(key);
      throw error;
    },
  );
  entries.set(key, entry);
  return entry.token;
}

/** a token the API refused (401): out of memory, unless another one already took its place */
export function dropOAuthToken(key: string, accessToken: string): void {
  if (entries.get(key)?.value?.accessToken === accessToken) entries.delete(key);
}

/**
 * A token from this process's memory: the refused one dropped, the one kept while good, otherwise asked from the
 * provider with `http` (once for everyone who needs it meanwhile).
 */
export async function oauthTokenFromMemory(request: OAuthTokenRequest, http: SendHttp, signal: AbortSignal = new AbortController().signal): Promise<SourcedOAuthToken> {
  const {key, fingerprint, connection, timeoutMs, refused} = request;
  if (refused) dropOAuthToken(key, refused);
  let askedMs: number | undefined;
  const token = await cachedOAuthToken(key, fingerprint, async () => {
    const t0 = performance.now();
    const got = await oauthToken(connection, async r => http({...r, timeoutMs, signal}));
    askedMs = Math.round(performance.now() - t0);
    return got;
  });
  return askedMs === undefined ? token : {...token, askedMs};
}

/** the access tokens in memory (hidden like secrets) */
export const cachedAccessTokens = (): string[] => [...entries.values()].flatMap(e => (e.value ? [e.value.accessToken] : []));

/** every token out of memory (tests; a process that wants to start clean) */
export function forgetOAuthTokens(): void {
  entries.clear();
}
