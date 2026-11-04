import type {SettingField} from '#types/setting-field.type';
import {connectionType, visibleFields, type ConnectionField, type ConnectionTypeName} from './connection-types';

/*
 * How a component that talks to an outside system (a database, an API) gets in. The user picks one: one of the
 * project's connection profiles (its id in `config.connection`), or no profile and the profile type's fields filled in
 * the component itself (inline, in its own config). A sensitive value is never in the flow either way: it is a
 * `secret` field naming one of the project's secrets. The runner turns both into the same thing: a connection string,
 * or the headers of an API's authentication.
 */

/** the key of a component's config holding the chosen profile's id ('' or missing: no profile, the inline fields apply) */
export const CONNECTION_KEY = 'connection';

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

/** a component's settings for its connection: the profile picker, then the inline fields (shown when no profile is picked) */
export function connectionSettings(type: ConnectionTypeName, label = 'Connection'): SettingField[] {
  return [{key: CONNECTION_KEY, label, kind: 'connection', connectionType: type, default: ''}, ...inlineFields(type).map(toSetting)];
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
  const use = connectionUse(type, config);
  if ('profile' in use) return [];
  const missing = applying(inlineFields(type), use.inline).filter(f => f.required && !use.inline[f.key]);
  if (missing.length === 0) return [];
  return [`has no connection (choose one, or fill in ${missing.map(f => f.label.toLowerCase()).join(', ')}).`];
}

/**
 * The connection ready to use: the profile (by id, of the right type) or the inline fields, and the values of their
 * secret fields. Throws when the profile or a secret is not in this runner.
 */
export function resolveConnection(
  type: ConnectionTypeName,
  use: ConnectionUse,
  profiles: Record<string, ConnectionProfileData> | undefined,
  secrets: Record<string, string> | undefined,
): ResolvedConnection {
  let config: Record<string, string>;
  let fields: ConnectionField[];
  if ('profile' in use) {
    const profile = profiles?.[use.profile];
    if (!profile) throw new Error(`The connection "${use.profile}" does not exist in this runner.`);
    if (profile.type !== type) throw new Error(`The connection "${profile.name ?? use.profile}" is not a ${connectionType(type).label} connection.`);
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

/** the headers a resolved API connection adds to a request: its authentication, and a profile's default headers */
export function connectionHeaders(connection: ResolvedConnection): Record<string, string> {
  const {config, secrets} = connection;
  const headers: Record<string, string> = {};
  for (const line of (config.headers ?? '').split('\n')) {
    const at = line.indexOf(':');
    if (at > 0) headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  if (config.auth === 'bearer' && secrets.token) headers.Authorization = `Bearer ${secrets.token}`;
  if (config.auth === 'apiKey' && secrets.apiKey) headers[config.apiKeyHeader?.trim() || 'X-API-Key'] = secrets.apiKey;
  return headers;
}
