import {toError} from '#errors/normalize-error';
import type {ComponentLogic} from '#types/component-logic.type';
import type {LogLevel} from '#types/log-level.type';

/**
 * Log: for each envelope, evaluates a message (an expression on the envelope) and records it, in the run's log of the
 * component and on the runner's console (console.debug/info/warn/error, with the flow and the component). The envelope
 * goes on unchanged. `debug` only in editor test runs: in a real run (Run for real, and the scheduled runs of a
 * published flow) a debug Log only passes the envelopes on. A message that fails is an error of the envelope.
 */

export type LogComponentLevel = 'debug' | 'info' | 'warn' | 'error';

export const LOG_LEVELS: LogComponentLevel[] = ['debug', 'info', 'warn', 'error'];

/** Lines one Log writes in the run's log; past that, only a count at the end (the console still gets every one). */
export const MAX_LOG_LINES = 500;

export function logConfig(config: Record<string, unknown>) {
  return {
    level: (LOG_LEVELS.includes(config.level as LogComponentLevel) ? config.level : 'info') as LogComponentLevel,
    message: typeof config.message === 'string' ? config.message : '',
  };
}

const RUN_LEVEL: Record<LogComponentLevel, LogLevel> = {debug: 'debug', info: 'info', warn: 'warning', error: 'error'};

/** What the message evaluated to, as text (an object or a list goes as JSON). */
function text(value: unknown) {
  if (typeof value === 'string') return value;
  if (value === undefined) return 'undefined';
  try {
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  } catch {
    return String(value);
  }
}

export const log: ComponentLogic = {
  type: 'log',
  inputs: 1,
  outputs: 1,

  validate(config) {
    return logConfig(config).message.trim() ? [] : ['has no message.'];
  },

  async* execute(inputs, config, ctx) {
    const {level, message} = logConfig(config);
    // debug is a test-run aid: a real run does not record it
    const silent = level === 'debug' && ctx.run.mode === 'execution';
    const where = `[${ctx.run.workflow} / ${ctx.node.label}]`;
    let lines = 0;
    for await (const doc of inputs['in-0'] ?? []) {
      if (!silent) {
        try {
          const line = text(ctx.fieldValue({value: message, expression: true}, doc));
          lines += 1;
          if (lines <= MAX_LOG_LINES) ctx.log(RUN_LEVEL[level], line);
          console[level](`${where} ${line}`);
        } catch (e) {
          yield {error: toError(e), doc};
          continue;
        }
      }
      yield {port: 'out-0', doc};
    }
    if (lines > MAX_LOG_LINES) ctx.log('info', `${lines - MAX_LOG_LINES} more line(s) not shown here (${lines} in all).`);
  },
};
