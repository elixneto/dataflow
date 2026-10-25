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
      <p>Records a message for each envelope, in the run&apos;s log and on the runner&apos;s console. The envelope goes on unchanged. E.g.: following what goes through a point of the flow.</p>
      <h4>Input and output</h4>
      <p>1 envelope port in, 1 out: the same envelopes, untouched.</p>
      <h4>Level</h4>
      <p><code>debug</code>, <code>info</code>, <code>warn</code> or <code>error</code>. On the runner it becomes <code>console.debug</code>, <code>console.info</code>, <code>console.warn</code> or <code>console.error</code>, with the flow and the component in front.</p>
      <p><b>debug only in test runs</b>: the editor&apos;s Run records it; <b>Run for real</b> and the scheduled runs of a published flow do not (the Log only passes the envelopes on). <code>info</code>, <code>warn</code> and <code>error</code> are always recorded.</p>
      <h4>Message</h4>
      <p>A JS expression on the envelope, like the Filter&apos;s condition. <code>$PARAMETERS</code>, <code>$WORKFLOW_CURRENT_RUN</code> and each field (<code>$field</code>) are available. Text goes in quotes; a template is handy: <code>{'`Order ${$id}: total ${$total}`'}</code>. An object or a list is written as JSON, e.g. <code>$items</code>.</p>
      <h4>Many envelopes</h4>
      <p>The run&apos;s log keeps the first {MAX_LOG_LINES} lines of each Log and then a count of the rest; the console gets every one.</p>
      <h4>Errors</h4>
      <p>A message that fails (e.g. <code>$doesNotExist.field</code>) is an error of the envelope and follows the card&apos;s &quot;On error&quot; policy.</p>
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
