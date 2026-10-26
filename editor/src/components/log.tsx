import {ScrollText} from 'lucide-react';
import {log, logConfig, LOG_LEVELS, MAX_LOG_LINES, type LogComponentLevel} from '@dataflow/core';
import {ExpressionBox} from '#ui/expression-field';
import {cn} from '#lib/utils';
import type {FieldsProps} from '#types/fields-props.type';
import type {ComponentDef} from '#types/component-def.type';

// Visual part of the Log. The logic is the core's.

const LEVEL_STYLE: Record<LogComponentLevel, string> = {
  debug: 'bg-muted text-muted-foreground',
  info: 'bg-primary/15 text-primary',
  warn: 'bg-comment/15 text-comment',
  error: 'bg-destructive/15 text-destructive',
};

function LogCard({config}: FieldsProps) {
  const {level, message} = logConfig(config);
  return (
    <div className="flex min-w-0 items-center gap-2 font-mono text-xs">
      <span className={cn('shrink-0 rounded px-1.5 font-semibold uppercase', LEVEL_STYLE[level])}>{level}</span>
      {message.trim()
        ? <span className="truncate text-primary" title={message}>{message}</span>
        : <span className="italic text-muted-foreground">No message</span>}
    </div>
  );
}

function LogPanel({id, nodeId, config, setConfig}: FieldsProps) {
  const {level, message} = logConfig(config);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span id={`${id}-level`} className="text-xs font-medium text-muted-foreground">Level</span>
        <div role="radiogroup" aria-labelledby={`${id}-level`} className="grid w-72 grid-cols-4 gap-0.5 rounded-md border border-input bg-background p-0.5">
          {LOG_LEVELS.map(value => (
            <button key={value} type="button" role="radio" aria-checked={value === level} onClick={() => setConfig('level', value)}
                    className={cn('h-7 rounded px-2 text-xs font-medium transition-colors',
                      value === level ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {value}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-message`} className="text-xs font-medium text-muted-foreground">Message</label>
        <ExpressionBox id={`${id}-message`} nodeId={nodeId} value={message} onValue={v => setConfig('message', v)}
                       multiline rows={3} placeholder="`Order ${$id}: total ${$total}`" label="Message"/>
      </div>
    </div>
  );
}

function LogDocs() {
  return (
    <>
      <p>Writes a message per envelope to the run&apos;s log and the runner&apos;s console; the envelope goes on unchanged.</p>
      <ul>
        <li>Message: an expression, e.g. <code>{'`Order ${$id}: ${$total}`'}</code>; an object goes as JSON.</li>
        <li>Levels: <code>debug</code> (test runs only), <code>info</code>, <code>warn</code>, <code>error</code>.</li>
        <li>The run&apos;s log keeps the first {MAX_LOG_LINES} lines of each Log; the console gets them all.</li>
      </ul>
    </>
  );
}

export const LOG: ComponentDef = {
  type: log.type,
  label: 'Log',
  description: 'Records a message for each envelope',
  category: 'flow',
  icon: ScrollText,
  inputs: log.inputs,
  outputs: log.outputs,
  defaultConfig: {level: 'info', message: ''},
  Card: LogCard,
  Panel: LogPanel,
  Docs: LogDocs,
  validate: config => log.validate(config),
};
