import type {ExpressionField} from '#types/expression-field.type';
import type {SettingField} from '#types/setting-field.type';
import {connectionType, visibleFields, type ConnectionField, type ConnectionTypeName} from './connection-types';

/*
 * How a component that talks to an outside system (a database, an API) gets in. The user picks one: one of the
 * project's connection profiles (its id in `config.connection`), or no profile and the profile type's fields filled in
 * the component itself (inline, in its own config). An HTTP request may also pick its profile in the run, by the name
 * an expression gives (DYNAMIC_CONNECTION). A sensitive value is never in the flow either way: it is a
 * `secret` field naming one of the project's secrets. The runner turns both into the same thing: a connection string,
 * or the headers of an API's authentication.
 */

/** the key of a component's config holding the chosen profile's id ('' or missing: no profile, the inline fields apply) */
export const CONNECTION_KEY = 'connection';

/** `config.connection` of a component that picks its profile in the run, by the name `config.connectionName` gives */
export const DYNAMIC_CONNECTION = '$dynamic';

/** the key of the value (an expression on the envelope) naming the profile of a DYNAMIC_CONNECTION */
export const CONNECTION_NAME_KEY = 'connectionName';

/** the fields of each profile type a component fills in when it uses no profile */
export const INLINE_FIELDS: Partial<Record<ConnectionTypeName, string[]>> = {
  sqlserver: ['host', 'port', 'database', 'user', 'password', 'encrypt', 'trustServerCertificate'],
  mongodb: ['connectionString'],
  'http-client': ['auth', 'token', 'apiKeyHeader', 'apiKey'],
};

const forFields = {key: 'connectWith', values: ['fields']};

/**
 * SQL Server without a profile connects either with the profile's fields or with a secret holding a whole connection
 * string ("Connect with"): the fields show for the mode picked.
 */
const SQL_SERVER_MODES: {first: ConnectionField[]; last: ConnectionField[]} = {
  first: [{
    key: 'connectWith', label: 'Connect with', kind: 'select', required: true, default: 'fields',
    options: [{value: 'fields', label: 'Fields'}, {value: 'string', label: 'Connection string'}],
  }],
  last: [{key: 'connectionString', label: 'Connection string', kind: 'secret', required: true, when: {key: 'connectWith', values: ['string']}}],
};

/** the API connection types an HTTP request can use: their authentication goes on its requests (SOAP is apart) */
export const API_CONNECTION_TYPES: ConnectionTypeName[] = ['http-client', 'rest-basic', 'rest-oauth2'];

/** a profile as the runner receives it (`RunOptions.connections`, by id): its secret fields name project secrets */
export type ConnectionProfileData = {name?: string; type: string; config: Record<string, string>};

/** what a component's config says about its connection: a profile, or the inline fields' values */
export type ConnectionUse = {profile: string} | {inline: Record<string, string>};

/** a connection ready to use: its type, its fields (a profile's or the inline ones) and the values of its secret fields */
export type ResolvedConnection = {type: ConnectionTypeName; config: Record<string, string>; secrets: Record<string, string>};

/** what a component fills in without a profile, in order */
export function inlineFields(type: ConnectionTypeName): ConnectionField[] {
  const fields = connectionType(type).fields.filter(f => INLINE_FIELDS[type]?.includes(f.key));
  if (type !== 'sqlserver') return fields;
  return [...SQL_SERVER_MODES.first, ...fields.map(f => ({...f, when: f.when ?? forFields})), ...SQL_SERVER_MODES.last];
}

/** the fields that apply to these values (their `when`) */
const applying = (fields: ConnectionField[], config: Record<string, string>) =>
  fields.filter(field => !field.when || field.when.values.includes(config[field.when.key] ?? ''));

const noProfile = {key: CONNECTION_KEY, values: ['']};

const toSetting = (f: ConnectionField): SettingField => ({
  key: f.key,
  label: f.label,
  kind: f.kind === 'textarea' ? 'code' : f.kind,
  required: f.required,
  default: f.default,
  placeholder: f.placeholder,
  options: f.options,
  // shown only without a profile (and, like in the profile's form, only for the values its own `when` asks)
  when: f.when ? [noProfile, f.when] : noProfile,
});

/**
 * a component's settings for its connection: the profile picker (profiles of the `accepted` types), then the inline
 * fields of `type` (shown when no profile is picked)
 */
export function connectionSettings(type: ConnectionTypeName, accepted: ConnectionTypeName[] = [type], label = 'Connection', dynamic = false): SettingField[] {
  const picker: SettingField = {key: CONNECTION_KEY, label, kind: 'connection', connectionType: type, connectionTypes: accepted, default: '', ...(dynamic ? {connectionDynamic: true} : {})};
  const byName: SettingField[] = dynamic
    ? [{
      key: CONNECTION_NAME_KEY, label: 'Connection name', kind: 'value', required: true, default: {value: '', expression: true},
      placeholder: '`[${$env}] My API`', when: {key: CONNECTION_KEY, values: [DYNAMIC_CONNECTION]},
    }]
    : [];
  return [picker, ...byName, ...inlineFields(type).map(toSetting)];
}

/** the value naming the profile when the config picks it in the run (DYNAMIC_CONNECTION), undefined otherwise */
export function dynamicConnection(config: Record<string, unknown>): ExpressionField | undefined {
  if (config[CONNECTION_KEY] !== DYNAMIC_CONNECTION) return undefined;
  const f = config[CONNECTION_NAME_KEY] as Partial<ExpressionField> | undefined;
  return {value: typeof f?.value === 'string' ? f.value : '', expression: typeof f?.expression === 'boolean' ? f.expression : true};
}

/** the connection a component's config asks for: a profile's id, or its inline fields (unset ones take their default) */
export function connectionUse(type: ConnectionTypeName, config: Record<string, unknown>): ConnectionUse {
  const id = typeof config[CONNECTION_KEY] === 'string' ? (config[CONNECTION_KEY] as string).trim() : '';
  if (id) return {profile: id};
  return {inline: Object.fromEntries(inlineFields(type).map(f => [f.key, String(config[f.key] ?? f.default ?? '').trim()]))};
}

/** whether the config picks a profile */
export const usesProfile = (type: ConnectionTypeName, config: Record<string, unknown>) => 'profile' in connectionUse(type, config);

/** the config's connection issue: none with a profile; without one, the inline fields that are required and empty */
export function connectionIssues(type: ConnectionTypeName, config: Record<string, unknown>): string[] {
  const dynamic = dynamicConnection(config);
  if (dynamic) return dynamic.value.trim() ? [] : ['has no connection name.'];
  const use = connectionUse(type, config);
  if ('profile' in use) return [];
  const missing = applying(inlineFields(type), use.inline).filter(f => f.required && !use.inline[f.key]);
  if (missing.length === 0) return [];
  return [`has no connection (choose one, or fill in ${missing.map(f => f.label.toLowerCase()).join(', ')}).`];
}

/** a profile by its id or, failing that, by its name (unique in the project, whatever the case) */
export function findProfile(profiles: Record<string, ConnectionProfileData> | undefined, ref: string): {id: string; profile: ConnectionProfileData} | undefined {
  if (!profiles) return undefined;
  if (profiles[ref]) return {id: ref, profile: profiles[ref]};
  const name = ref.trim().toLowerCase();
  const found = Object.entries(profiles).find(([, p]) => p.name?.trim().toLowerCase() === name);
  return found && {id: found[0], profile: found[1]};
}

/**
 * The connection ready to use: the profile (by id or name, of one of the `accepted` types: its own type then) or the
 * inline fields (of `type`), and the values of their secret fields. Throws when the profile or a secret is not in this runner.
 */
export function resolveConnection(
  type: ConnectionTypeName,
  use: ConnectionUse,
  profiles: Record<string, ConnectionProfileData> | undefined,
  secrets: Record<string, string> | undefined,
  accepted: ConnectionTypeName[] = [type],
): ResolvedConnection {
  let config: Record<string, string>;
  let fields: ConnectionField[];
  if ('profile' in use) {
    const profile = findProfile(profiles, use.profile)?.profile;
    if (!profile) throw new Error(`The connection "${use.profile}" does not exist in this runner.`);
    if (!accepted.includes(profile.type as ConnectionTypeName)) {
      throw new Error(`The connection "${profile.name ?? use.profile}" is not a ${accepted.map(t => connectionType(t).label).join(' or ')} connection.`);
    }
    type = profile.type as ConnectionTypeName;
    config = profile.config;
    fields = visibleFields(type, config);
  } else {
    config = use.inline;
    fields = applying(inlineFields(type), config);
  }
  const values: Record<string, string> = {};
  for (const field of fields.filter(f => f.kind === 'secret' && config[f.key])) {
    const name = config[field.key] as string;
    const value = secrets?.[name];
    if (value === undefined) throw new Error(`The secret "${name}" does not exist in this runner.`);
    values[field.key] = value;
  }
  return {type, config, secrets: values};
}

/** a value in a SQL Server connection string: in braces when it has a character that would end it */
const sqlValue = (value: string) => (/[;{}=]|^\s|\s$/.test(value) ? `{${value.replace(/}/g, '}}')}}` : value);

/** the connection string of a resolved database connection (what the runner's driver receives) */
export function connectionString(connection: ResolvedConnection): string {
  const {config, secrets} = connection;
  switch (connection.type) {
    case 'mongodb':
      return secrets.connectionString ?? '';
    case 'sqlserver':
      if (config.connectWith === 'string') return secrets.connectionString ?? '';
      return [
        `Server=${sqlValue(`${config.host ?? ''},${config.port || '1433'}`)}`,
        `Database=${sqlValue(config.database ?? '')}`,
        `User Id=${sqlValue(config.user ?? '')}`,
        `Password=${sqlValue(secrets.password ?? '')}`,
        `Encrypt=${config.encrypt !== 'off'}`,
        `TrustServerCertificate=${config.trustServerCertificate === 'on'}`,
      ].join(';');
    default:
      throw new Error(`A ${connectionType(connection.type).label} connection has no connection string.`);
  }
}

/** text as base64, as UTF-8 (a user name with an accent goes as it is) */
const base64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

/**
 * the headers a resolved API connection adds to a request: its authentication (bearer, API key, basic; an OAuth 2.0
 * token is fetched apart, see `oauthToken`) and a profile's default headers
 */
export function connectionHeaders(connection: ResolvedConnection, oauthAccessToken?: string): Record<string, string> {
  const {type, config, secrets} = connection;
  const headers: Record<string, string> = {};
  for (const line of (config.headers ?? '').split('\n')) {
    const at = line.indexOf(':');
    if (at > 0) headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  if (type === 'rest-basic') headers.Authorization = `Basic ${base64(`${config.user ?? ''}:${secrets.password ?? ''}`)}`;
  if (type === 'rest-oauth2' && oauthAccessToken) headers.Authorization = `Bearer ${oauthAccessToken}`;
  if (type === 'http-client' && config.auth === 'bearer' && secrets.token) headers.Authorization = `Bearer ${secrets.token}`;
  if (type === 'http-client' && config.auth === 'apiKey' && secrets.apiKey) headers[config.apiKeyHeader?.trim() || 'X-API-Key'] = secrets.apiKey;
  return headers;
}

/** a token and when it stops being good (ms since 1970) */
export type OAuthToken = {accessToken: string; expiresAt: number};

/** a token is renewed this long before it expires, so a request does not go with one about to end */
const TOKEN_MARGIN_MS = 30_000;

export const tokenStillGood = (token: OAuthToken | undefined, now = Date.now()): token is OAuthToken => !!token && token.expiresAt - TOKEN_MARGIN_MS > now;

/**
 * An OAuth 2.0 connection's access token (client credentials): asked from its token URL with the client id and secret
 * (form-encoded, as RFC 6749 says), with the scopes and the audience when set. The authorization code grant needs a
 * person to log in: not in a run.
 */
export async function oauthToken(
  connection: ResolvedConnection,
  send: (request: {method: string; url: string; headers: Record<string, string>; body: string}) => Promise<{status: number; body: string}>,
  now = Date.now(),
): Promise<OAuthToken> {
  const {config, secrets} = connection;
  if (config.grant === 'authorizationCode') throw new Error('An OAuth 2.0 connection with the authorization code grant cannot be used in a run yet; use client credentials.');
  const form = new URLSearchParams({grant_type: 'client_credentials', client_id: config.clientId ?? '', client_secret: secrets.clientSecret ?? ''});
  if (config.scopes?.trim()) form.set('scope', config.scopes.trim());
  if (config.audience?.trim()) form.set('audience', config.audience.trim());
  const response = await send({
    method: 'POST',
    url: config.tokenUrl ?? '',
    headers: {'content-type': 'application/x-www-form-urlencoded', accept: 'application/json'},
    body: form.toString(),
  });
  let answer: {access_token?: unknown; expires_in?: unknown; error?: unknown; error_description?: unknown} = {};
  try {
    answer = JSON.parse(response.body) as typeof answer;
  } catch {
    // not JSON: no token below
  }
  if (response.status < 200 || response.status >= 300 || typeof answer.access_token !== 'string') {
    // the provider's reason (RFC 6749: error, error_description), or the start of its answer
    const reason = [answer.error, answer.error_description].filter(v => typeof v === 'string' && v).join(': ') || response.body.slice(0, 200).trim();
    throw new Error(`The OAuth 2.0 token request to ${config.tokenUrl} failed (HTTP ${response.status})${reason ? `: ${reason}` : ''}.`);
  }
  const seconds = Number(answer.expires_in);
  return {accessToken: answer.access_token, expiresAt: now + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000};
}
