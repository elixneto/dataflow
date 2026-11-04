/*
 * The kinds of connection profile (a reusable connection, like a SnapLogic Account) and their fields, declared once and
 * shared: the editor builds the form and the list from them, the server validates with them (connection-profile.ts).
 * A profile holds how to get in (host, credentials), not what to call: the URL of an API (or the WSDL of a SOAP service)
 * is set where a flow calls it, so one profile serves every endpoint of a service. A sensitive value (password, client
 * secret, token, key) is never a field of the profile: it is a `secret` field that names one of the project's secrets,
 * so the value stays encrypted and one secret can serve several profiles. How each type looks is the editor's.
 */

export type FieldKind = 'text' | 'number' | 'textarea' | 'select' | 'secret';

export type ConnectionField = {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  default?: string;
  placeholder?: string;
  /** for selects */
  options?: {value: string; label: string}[];
  /** shown only when another field has one of these values (e.g. the token only for bearer auth) */
  when?: {key: string; values: string[]};
};

export type ConnectionGroup = 'api' | 'storage' | 'database' | 'messaging';

/** The groups, in the order they are shown. */
export const CONNECTION_GROUPS: {group: ConnectionGroup; label: string}[] = [
  {group: 'api', label: 'APIs'},
  {group: 'storage', label: 'Storage'},
  {group: 'database', label: 'Databases'},
  {group: 'messaging', label: 'Messaging'},
];

export type ConnectionTypeName =
  | 'rest-basic'
  | 'rest-oauth2'
  | 'http-client'
  | 'soap'
  | 's3'
  | 'azure-blob'
  | 'gcs'
  | 'sftp'
  | 'postgresql'
  | 'sqlserver'
  | 'mysql'
  | 'mongodb'
  | 'redshift'
  | 'kafka'
  | 'rabbitmq'
  | 'azure-service-bus'
  | 'sqs';

export type ConnectionType = {
  type: ConnectionTypeName;
  label: string;
  group: ConnectionGroup;
  fields: ConnectionField[];
  /** what the list shows next to the type (host, URL, bucket...) */
  summary: (config: Record<string, string>) => string;
};

// ---- building blocks

const select = (key: string, label: string, options: [string, string][], fallback: string, when?: ConnectionField['when']): ConnectionField => ({
  key,
  label,
  kind: 'select',
  required: true,
  default: fallback,
  options: options.map(([value, text]) => ({value, label: text})),
  when,
});

const onOff = (key: string, label: string, fallback: 'on' | 'off'): ConnectionField =>
  select(key, label, [['on', 'Enabled'], ['off', 'Disabled']], fallback);

const headers: ConnectionField = {key: 'headers', label: 'Default headers (one "Name: value" per line)', kind: 'textarea'};

const database = (defaultPort: string, extra: ConnectionField[] = []): ConnectionField[] => [
  {key: 'host', label: 'Host', kind: 'text', required: true, placeholder: 'db.example.com'},
  {key: 'port', label: 'Port', kind: 'number', required: true, default: defaultPort},
  {key: 'database', label: 'Database', kind: 'text', required: true},
  {key: 'user', label: 'User', kind: 'text', required: true},
  {key: 'password', label: 'Password', kind: 'secret', required: true},
  ...extra,
];

const awsKeys: ConnectionField[] = [
  {key: 'accessKeyId', label: 'Access key ID', kind: 'text', required: true},
  {key: 'secretAccessKey', label: 'Secret access key', kind: 'secret', required: true},
];

const region: ConnectionField = {key: 'region', label: 'Region', kind: 'text', required: true, placeholder: 'us-east-1'};

const join = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' / ');

// ---- the types

export const CONNECTION_TYPES: ConnectionType[] = [
  // APIs
  {
    type: 'rest-basic',
    label: 'REST Basic Authentication',
    group: 'api',
    fields: [
      {key: 'user', label: 'Username', kind: 'text', required: true},
      {key: 'password', label: 'Password', kind: 'secret', required: true},
      headers,
    ],
    summary: config => (config.user ? `User ${config.user}` : ''),
  },
  {
    type: 'rest-oauth2',
    label: 'REST OAuth 2.0',
    group: 'api',
    fields: [
      select('grant', 'Grant type', [['clientCredentials', 'Client credentials'], ['authorizationCode', 'Authorization code']], 'clientCredentials'),
      {key: 'authorizeUrl', label: 'Authorization URL', kind: 'text', required: true, when: {key: 'grant', values: ['authorizationCode']}},
      {key: 'tokenUrl', label: 'Token URL', kind: 'text', required: true, placeholder: 'https://auth.example.com/oauth/token'},
      {key: 'clientId', label: 'Client ID', kind: 'text', required: true},
      {key: 'clientSecret', label: 'Client secret', kind: 'secret', required: true},
      {key: 'scopes', label: 'Scopes (space separated)', kind: 'text'},
      {key: 'audience', label: 'Audience', kind: 'text'},
    ],
    summary: config => join(config.grant === 'authorizationCode' ? 'Authorization code' : 'Client credentials', config.clientId),
  },
  {
    type: 'http-client',
    label: 'HTTP Client Account',
    group: 'api',
    fields: [
      select('auth', 'Authentication', [['none', 'None'], ['bearer', 'Bearer token'], ['apiKey', 'API key']], 'none'),
      {key: 'token', label: 'Token', kind: 'secret', required: true, when: {key: 'auth', values: ['bearer']}},
      {key: 'apiKeyHeader', label: 'Header name', kind: 'text', required: true, default: 'X-API-Key', when: {key: 'auth', values: ['apiKey']}},
      {key: 'apiKey', label: 'API key', kind: 'secret', required: true, when: {key: 'auth', values: ['apiKey']}},
      headers,
      {key: 'timeout', label: 'Timeout (seconds)', kind: 'number', default: '30'},
    ],
    summary: config => ({none: 'No authentication', bearer: 'Bearer token', apiKey: `API key (${config.apiKeyHeader ?? ''})`})[config.auth ?? 'none'] ?? '',
  },
  {
    type: 'soap',
    label: 'SOAP',
    group: 'api',
    fields: [
      select('auth', 'Authentication', [['none', 'None'], ['basic', 'Basic'], ['wsSecurity', 'WS-Security username token']], 'none'),
      {key: 'user', label: 'Username', kind: 'text', required: true, when: {key: 'auth', values: ['basic', 'wsSecurity']}},
      {key: 'password', label: 'Password', kind: 'secret', required: true, when: {key: 'auth', values: ['basic', 'wsSecurity']}},
    ],
    summary: config => ({none: 'No authentication', basic: `Basic, user ${config.user ?? ''}`, wsSecurity: `WS-Security, user ${config.user ?? ''}`})[config.auth ?? 'none'] ?? '',
  },

  // Storage
  {
    type: 's3',
    label: 'Amazon S3',
    group: 'storage',
    fields: [
      region,
      {key: 'bucket', label: 'Bucket', kind: 'text', required: true},
      ...awsKeys,
      {key: 'endpoint', label: 'Endpoint (S3-compatible storage)', kind: 'text'},
    ],
    summary: config => join(config.bucket, config.region),
  },
  {
    type: 'azure-blob',
    label: 'Azure Blob Storage',
    group: 'storage',
    fields: [
      select('auth', 'Authentication', [['connectionString', 'Connection string'], ['accountKey', 'Account name and key'], ['sas', 'SAS token']], 'connectionString'),
      {key: 'connectionString', label: 'Connection string', kind: 'secret', required: true, when: {key: 'auth', values: ['connectionString']}},
      {key: 'account', label: 'Account name', kind: 'text', required: true, when: {key: 'auth', values: ['accountKey', 'sas']}},
      {key: 'accountKey', label: 'Account key', kind: 'secret', required: true, when: {key: 'auth', values: ['accountKey']}},
      {key: 'sasToken', label: 'SAS token', kind: 'secret', required: true, when: {key: 'auth', values: ['sas']}},
      {key: 'container', label: 'Container', kind: 'text', required: true},
    ],
    summary: config => join(config.account, config.container),
  },
  {
    type: 'gcs',
    label: 'Google Cloud Storage',
    group: 'storage',
    fields: [
      {key: 'projectId', label: 'Project ID', kind: 'text', required: true},
      {key: 'bucket', label: 'Bucket', kind: 'text', required: true},
      {key: 'serviceAccountKey', label: 'Service account key (JSON)', kind: 'secret', required: true},
    ],
    summary: config => join(config.bucket, config.projectId),
  },
  {
    type: 'sftp',
    label: 'SFTP',
    group: 'storage',
    fields: [
      {key: 'host', label: 'Host', kind: 'text', required: true, placeholder: 'sftp.example.com'},
      {key: 'port', label: 'Port', kind: 'number', required: true, default: '22'},
      {key: 'user', label: 'User', kind: 'text', required: true},
      {key: 'privateKey', label: 'Password or private key', kind: 'secret', required: true},
      {key: 'directory', label: 'Directory', kind: 'text', default: '/'},
    ],
    summary: config => config.host ?? '',
  },

  // Databases
  {type: 'postgresql', label: 'PostgreSQL', group: 'database', fields: database('5432'), summary: config => join(config.host, config.database)},
  {
    type: 'sqlserver',
    label: 'SQL Server',
    group: 'database',
    fields: database('1433', [onOff('encrypt', 'Encrypt', 'on'), onOff('trustServerCertificate', 'Trust server certificate', 'off')]),
    summary: config => join(config.host, config.database),
  },
  {type: 'mysql', label: 'MySQL', group: 'database', fields: database('3306'), summary: config => join(config.host, config.database)},
  {
    type: 'mongodb',
    label: 'MongoDB',
    group: 'database',
    fields: [
      {key: 'connectionString', label: 'Connection string', kind: 'secret', required: true},
      {key: 'database', label: 'Database', kind: 'text', required: true},
    ],
    summary: config => config.database ?? '',
  },
  {
    type: 'redshift',
    label: 'Amazon Redshift',
    group: 'database',
    fields: database('5439', [onOff('ssl', 'SSL', 'on')]),
    summary: config => join(config.host, config.database),
  },

  // Messaging
  {
    type: 'kafka',
    label: 'Kafka',
    group: 'messaging',
    fields: [
      {key: 'bootstrapServers', label: 'Bootstrap servers (comma separated)', kind: 'text', required: true, placeholder: 'broker1:9092,broker2:9092'},
      select('security', 'Security protocol', [['PLAINTEXT', 'PLAINTEXT'], ['SSL', 'SSL'], ['SASL_SSL', 'SASL_SSL']], 'SASL_SSL'),
      select('mechanism', 'SASL mechanism', [['PLAIN', 'PLAIN'], ['SCRAM-SHA-256', 'SCRAM-SHA-256'], ['SCRAM-SHA-512', 'SCRAM-SHA-512']], 'PLAIN', {key: 'security', values: ['SASL_SSL']}),
      {key: 'user', label: 'Username', kind: 'text', required: true, when: {key: 'security', values: ['SASL_SSL']}},
      {key: 'password', label: 'Password', kind: 'secret', required: true, when: {key: 'security', values: ['SASL_SSL']}},
      {key: 'clientId', label: 'Client ID', kind: 'text'},
    ],
    summary: config => config.bootstrapServers ?? '',
  },
  {
    type: 'rabbitmq',
    label: 'RabbitMQ',
    group: 'messaging',
    fields: [
      {key: 'host', label: 'Host', kind: 'text', required: true, placeholder: 'rabbit.example.com'},
      {key: 'port', label: 'Port', kind: 'number', required: true, default: '5672'},
      {key: 'vhost', label: 'Virtual host', kind: 'text', default: '/'},
      {key: 'user', label: 'Username', kind: 'text', required: true},
      {key: 'password', label: 'Password', kind: 'secret', required: true},
      onOff('tls', 'TLS', 'off'),
    ],
    summary: config => join(config.host, config.vhost),
  },
  {
    type: 'azure-service-bus',
    label: 'Azure Service Bus',
    group: 'messaging',
    fields: [
      {key: 'namespace', label: 'Namespace', kind: 'text', required: true, placeholder: 'my-namespace.servicebus.windows.net'},
      select('auth', 'Authentication', [['connectionString', 'Connection string'], ['sasKey', 'SAS key name and key']], 'connectionString'),
      {key: 'connectionString', label: 'Connection string', kind: 'secret', required: true, when: {key: 'auth', values: ['connectionString']}},
      {key: 'keyName', label: 'SAS key name', kind: 'text', required: true, when: {key: 'auth', values: ['sasKey']}},
      {key: 'key', label: 'SAS key', kind: 'secret', required: true, when: {key: 'auth', values: ['sasKey']}},
    ],
    summary: config => config.namespace ?? '',
  },
  {
    type: 'sqs',
    label: 'Amazon SQS',
    group: 'messaging',
    fields: [region, {key: 'queueUrl', label: 'Queue URL', kind: 'text', required: true}, ...awsKeys],
    summary: config => config.queueUrl ?? '',
  },
];

export const connectionType = (type: ConnectionTypeName) => CONNECTION_TYPES.find(t => t.type === type)!;

/** the types by group (in CONNECTION_GROUPS order); `search` filters by the type's or the group's name */
export function typesByGroup(search = ''): {group: ConnectionGroup; label: string; types: ConnectionType[]}[] {
  const term = search.trim().toLowerCase();
  return CONNECTION_GROUPS.map(({group, label}) => ({
    group,
    label,
    types: CONNECTION_TYPES.filter(t => t.group === group && (!term || t.label.toLowerCase().includes(term) || label.toLowerCase().includes(term))),
  })).filter(g => g.types.length > 0);
}

/** the fields that apply to this config (those whose `when` matches) */
export const visibleFields = (type: ConnectionTypeName, config: Record<string, string>) =>
  connectionType(type).fields.filter(field => !field.when || field.when.values.includes(config[field.when.key] ?? ''));

/** a new profile's config: every field's default */
export const defaultConfig = (type: ConnectionTypeName): Record<string, string> =>
  Object.fromEntries(connectionType(type).fields.filter(f => f.default !== undefined).map(f => [f.key, f.default!]));
