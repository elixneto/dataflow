import {Globe, Plus, X} from 'lucide-react';
import {httpConfig, httpRequest, HTTP_METHODS, DEFAULT_HTTP_TIMEOUT_S, MAX_HTTP_CONCURRENCY, type HttpPair} from '@dataflow/core';
import {ExpressionBox, ExpressionInput, fieldInput} from '#ui/expression-field';
import {cn} from '#lib/utils';
import type {FieldsProps} from '#types/fields-props.type';
import type {ComponentDef} from '#types/component-def.type';

// Visual part of the HTTP Request. The logic is the core's; the runner sends the requests.

function HttpCard({config}: FieldsProps) {
  const {method, url} = httpConfig(config);
  return (
    <div className="flex flex-col gap-1 font-mono text-xs">
      <p className="truncate" title={url.value}>
        <span className={cn('font-semibold', method === 'GET' ? 'text-primary' : 'text-entity')}>{method}</span> {url.value || '?'}
      </p>
    </div>
  );
}

function PairList({nodeId, title, item, pairs, onChange, placeholder}: {
  nodeId: string;
  title: string;
  item: string;
  pairs: HttpPair[];
  onChange: (pairs: HttpPair[]) => void;
  placeholder: string;
}) {
  const change = (i: number, update: Partial<HttpPair>) => onChange(pairs.map((p, j) => (j === i ? {...p, ...update} : p)));
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {pairs.length > 0 && (
        <div className="flex flex-col overflow-hidden rounded-md border border-border">
          {pairs.map((p, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_32px] items-center gap-x-1.5 border-b border-border px-2 py-1.5 last:border-b-0">
              <input value={p.name} onChange={e => change(i, {name: e.target.value})} placeholder={placeholder} spellCheck={false}
                     aria-label={`Name of ${item} ${i + 1}`} className={cn(fieldInput, 'font-mono')}/>
              <ExpressionInput nodeId={nodeId} label={`Value of ${item} ${i + 1}`} value={p.value} expression={p.expression}
                               onValue={value => change(i, {value})} onExpression={expression => change(i, {expression})}/>
              <button type="button" onClick={() => onChange(pairs.filter((_, j) => j !== i))} aria-label={`Remove ${item} ${i + 1}`}
                      className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                <X className="size-4" aria-hidden="true"/>
              </button>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={() => onChange([...pairs, {name: '', value: '', expression: false}])}
              className="flex h-8 items-center justify-center gap-1 rounded-md border border-dashed border-input text-sm text-muted-foreground hover:border-ring hover:text-foreground">
        <Plus className="size-3.5" aria-hidden="true"/> Add {item}
      </button>
    </section>
  );
}

function HttpPanel({id, nodeId, config, setConfig}: FieldsProps) {
  const {method, url, query, headers, body, timeoutS, concurrency, failOnError} = httpConfig(config);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <select value={method} onChange={e => setConfig('method', e.target.value)} aria-label="Method"
                className={cn(fieldInput, 'w-28 font-mono font-semibold')}>
          {HTTP_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <ExpressionInput nodeId={nodeId} label="URL" value={url.value} expression={url.expression} placeholder="https://api.example.com/items"
                         onValue={value => setConfig('url', {...url, value})} onExpression={expression => setConfig('url', {...url, expression})}/>
      </div>

      <PairList nodeId={nodeId} title="Query params" item="param" pairs={query} placeholder="page" onChange={v => setConfig('query', v)}/>
      <PairList nodeId={nodeId} title="Headers" item="header" pairs={headers} placeholder="Authorization" onChange={v => setConfig('headers', v)}/>

      {method !== 'GET' && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">Body</h3>
          <ExpressionBox nodeId={nodeId} label="Body expression" value={body.value} multiline rows={4}
                         placeholder="({name: $name, email: $email})" onValue={value => setConfig('body', {value, expression: true})}/>
        </section>
      )}

      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
        <label htmlFor={`${id}-timeout`} className="text-xs font-medium text-muted-foreground">Timeout (s)</label>
        <input id={`${id}-timeout`} type="number" min={1} value={timeoutS}
               onChange={e => setConfig('timeoutS', Math.max(1, Math.round(Number(e.target.value) || DEFAULT_HTTP_TIMEOUT_S)))}
               className={cn(fieldInput, 'w-28 font-mono')}/>
        <label htmlFor={`${id}-concurrency`} className="text-xs font-medium text-muted-foreground">Concurrency</label>
        <input id={`${id}-concurrency`} type="number" min={1} max={MAX_HTTP_CONCURRENCY} value={concurrency}
               onChange={e => setConfig('concurrency', Math.min(MAX_HTTP_CONCURRENCY, Math.max(1, Math.round(Number(e.target.value) || 1))))}
               className={cn(fieldInput, 'w-28 font-mono')}/>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={failOnError} onChange={e => setConfig('failOnError', e.target.checked)} className="nodrag size-4"/>
        Fail on non-2xx
      </label>
    </div>
  );
}

function HttpDocs() {
  return (
    <>
      <p>One HTTP request per envelope; the answer goes into <code>$response</code>: <code>{'{status, headers, body}'}</code>.</p>
      <ul>
        <li>URL, query params, headers and body can be expressions; a token comes from a secret: <code>{"'Bearer ' + $SECRETS.API_TOKEN"}</code>.</li>
        <li>An object body goes as JSON; a JSON answer comes parsed.</li>
        <li><b>Fail on non-2xx</b> (on by default): an error status is an error of the envelope.</li>
        <li>Test run: a GET is sent; POST, PUT, PATCH and DELETE are not (<code>{'{notSent: true}'}</code>). Run for real sends them.</li>
        <li>Up to {MAX_HTTP_CONCURRENCY} requests at once, output in arrival order. Secrets show as <code>***</code> in the logs.</li>
      </ul>
    </>
  );
}

export const HTTP_REQUEST: ComponentDef = {
  type: httpRequest.type,
  label: 'HTTP Request',
  description: 'Sends one HTTP request per envelope',
  category: 'api',
  icon: Globe,
  inputs: httpRequest.inputs,
  outputs: httpRequest.outputs,
  usesOverride: true,
  defaultOutputKey: httpRequest.defaultOutputKey,
  windowSize: {w: 720, h: 600},
  defaultConfig: {method: 'GET', url: {value: '', expression: false}, query: [], headers: [], body: {value: '', expression: true},
    timeoutS: DEFAULT_HTTP_TIMEOUT_S, concurrency: 1, failOnError: true},
  Card: HttpCard,
  Panel: HttpPanel,
  Docs: HttpDocs,
  validate: config => httpRequest.validate(config),
};
