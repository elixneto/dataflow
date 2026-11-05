import type {LogLevel} from '#types/log-level.type';

/**
 * `byComponent`: the component wrote it (ctx.log: a Log, a script's console.error...), what it logs, not a failure of
 * the run; an error line without it is one the engine wrote (an envelope that failed, a component that stopped)
 */
export type LogLine = {at: string; level: LogLevel; message: string; byComponent?: true};
