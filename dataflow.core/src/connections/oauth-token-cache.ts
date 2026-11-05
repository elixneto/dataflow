import {tokenStillGood, type OAuthToken, type ResolvedConnection} from './connection-access';

/*
 * The OAuth 2.0 access tokens of the runner's process, one per connection: a profile by its id, a connection filled in
 * the component itself by its fields. A token is asked once and used by every run of the process (a called flow, its
 * 500 envelopes, the next run) until it is about to expire; one asked for while another request for it is on its way
 * waits for that one (no rush of requests). Kept only in memory: never in the database, never in a log. Gone when the
 * process ends; the next request asks again.
 */

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

/** the access tokens in memory (hidden like secrets) */
export const cachedAccessTokens = (): string[] => [...entries.values()].flatMap(e => (e.value ? [e.value.accessToken] : []));

/** every token out of memory (tests; a process that wants to start clean) */
export function forgetOAuthTokens(): void {
  entries.clear();
}
