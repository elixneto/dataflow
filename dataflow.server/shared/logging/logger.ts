/*
 * The api's and the supervisor's own log (not a run's: that one goes to its record). One event per line, with fields:
 *
 *   pretty  for a terminal (`bun run dev`): the message, then key=value; warnings and errors tagged
 *   json    for a log collector (Docker -> otel-collector -> OpenObserve): {"time","level","service","msg",...fields},
 *           the fields' names in snake_case (runId -> run_id)
 *
 * LOG_LEVEL (debug, info, warn, error; default info) and LOG_FORMAT (pretty, json; default pretty) choose them.
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type ServerLogLevel = (typeof LOG_LEVELS)[number];

export const LOG_FORMATS = ['pretty', 'json'] as const;
export type LogFormat = (typeof LOG_FORMATS)[number];

/** what an event carries besides its message; undefined values are left out, an Error becomes its message and stack */
export type LogFields = Record<string, unknown>;

export type Logger = {
  debug: (msg: string, fields?: LogFields) => void;
  info: (msg: string, fields?: LogFields) => void;
  warn: (msg: string, fields?: LogFields) => void;
  error: (msg: string, fields?: LogFields) => void;
  /** a logger whose events all carry these fields too */
  child: (fields: LogFields) => Logger;
};

export type LoggerOptions = {
  /** who writes (api, supervisor): the `service` field */
  service: string;
  level?: ServerLogLevel;
  format?: LogFormat;
  /** where a line goes (default: stdout, stderr for warnings and errors) */
  write?: (line: string, level: ServerLogLevel) => void;
};

const RANK: Record<ServerLogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const TAG: Partial<Record<ServerLogLevel, string>> = { warn: 'WARN ', error: 'ERROR ' };

const writeOut = (line: string, level: ServerLogLevel) => (level === 'warn' || level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);

/** the fields as they are written: no undefined, an Error as its message (and its stack, apart) */
function plain(fields: LogFields): { values: LogFields; stack?: string } {
  const values: LogFields = {};
  let stack: string | undefined;
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      continue;
    }

    if (value instanceof Error) {
      values[key] = value.message;
      stack ??= value.stack;
    } else {
      values[key] = value;
    }
  }

  return { values, stack };
}

/** a value for key=value: quoted when it has spaces, quotes or is empty; objects as JSON */
function pretty(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text === '' || /[\s"=]/.test(text) ? JSON.stringify(text) : text;
}

/** runId -> run_id: what a log store indexes as is (OpenObserve lowercases field names: runid would be hard to read) */
const snake = (key: string) => key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
const snakeKeys = (values: LogFields) => Object.fromEntries(Object.entries(values).map(([key, value]) => [snake(key), value]));

export function createLogger(options: LoggerOptions, bound: LogFields = {}): Logger {
  const { service, level = 'info', format = 'pretty', write = writeOut } = options;
  const emit = (at: ServerLogLevel, msg: string, fields: LogFields = {}) => {
    if (RANK[at] < RANK[level]) {
      return;
    }

    const { values, stack } = plain({ ...bound, ...fields });
    if (format === 'json') {
      write(JSON.stringify({ time: new Date().toISOString(), level: at, service, msg, ...snakeKeys(values), ...(stack ? { stack } : {}) }), at);
      return;
    }

    const pairs = Object.entries(values).map(([key, value]) => `${key}=${pretty(value)}`);
    write(`${TAG[at] ?? ''}${msg}${pairs.length > 0 ? `  ${pairs.join(' ')}` : ''}${stack && at === 'error' ? `\n${stack}` : ''}`, at);
  };

  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    child: fields => createLogger(options, { ...bound, ...fields }),
  };
}

/** a logger that writes nothing (tests) */
export const silentLogger = (): Logger => createLogger({ service: 'silent', write: () => {} });
