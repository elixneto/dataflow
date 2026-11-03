import {useParams} from 'react-router';
import {Workflow} from 'lucide-react';
import {workflowInvokerConfig, MAX_WORKFLOW_DEPTH, workflowInvoker, type InvokerParameter} from '@dataflow/core';
import {ExpressionInput, fieldInput} from '#ui/expression-field';
import {cn} from '#lib/utils';
import {listFlows, getFlow, type Flow} from '#data/flows';
import type {FieldsProps} from '#types/fields-props.type';
import type {ComponentDef} from '#types/component-def.type';
import type {Config} from '#types/config.type';

// Visual part of the Workflow Invoker. The logic is the core's; the editor sends the called workflows along.

const startAcceptsInput = (flow?: Flow) =>
  flow?.nodes.some(n => n.type === 'component' && n.data.type === 'start' && n.data.config.acceptsInput === true) ?? false;

function WorkflowCard({config}: FieldsProps) {
  const {workflowId, parameters} = workflowInvokerConfig(config);
  const target = workflowId ? getFlow(workflowId) : undefined;
  if (!workflowId) return <p className="text-xs italic text-muted-foreground">No workflow</p>;
  return (
    <div className="flex flex-col gap-1 text-xs">
      <p className={cn('truncate font-medium', !target && 'text-destructive')} title={target?.name}>{target?.name ?? 'Workflow not found'}</p>
      {parameters.filter(p => p.value).slice(0, 4).map(p => (
        <p key={p.name} className="flex min-w-0 items-baseline gap-1.5 font-mono">
          <span className="shrink-0 font-semibold">{p.name}:</span>
          <span className={cn('min-w-0 truncate', p.expression ? 'text-primary' : 'text-muted-foreground')} title={p.value}>{p.expression ? p.value : `"${p.value}"`}</span>
        </p>
      ))}
    </div>
  );
}

function WorkflowPanel({id, nodeId, config, setConfig}: FieldsProps) {
  const {flowId} = useParams();
  const {workflowId, parameters, sendEnvelope} = workflowInvokerConfig(config);
  const options = listFlows().filter(f => f.id !== flowId).sort((a, b) => a.name.localeCompare(b.name));
  const target = options.find(f => f.id === workflowId);
  const acceptsInput = startAcceptsInput(target);
  // one row per parameter of the called workflow's Start, with the stored value (if any)
  const rows = (target?.parameters ?? []).map(p => ({
    def: p,
    value: parameters.find(v => v.name === p.name) ?? {name: p.name, value: '', expression: true},
  }));
  const change = (name: string, update: Partial<InvokerParameter>) => {
    const current = rows.map(r => r.value);
    setConfig('parameters', current.map(v => (v.name === name ? {...v, ...update} : v)));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
        <label htmlFor={`${id}-workflow`} className="text-xs font-medium text-muted-foreground">Workflow</label>
        <select id={`${id}-workflow`} value={workflowId} className={fieldInput}
                onChange={e => {
                  setConfig('workflowId', e.target.value);
                  setConfig('parameters', []);
                  if (!startAcceptsInput(getFlow(e.target.value))) setConfig('sendEnvelope', false);
                }}>
          <option value="">Choose…</option>
          {workflowId && !target && <option value={workflowId}>(not found)</option>}
          {options.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>

      {target && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">Start parameters</h3>
          <div className="flex flex-col overflow-hidden rounded-md border border-border">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-x-1.5 border-b border-border bg-muted/50 px-2 py-1.5 text-xs font-medium text-muted-foreground">
              <span>Parameter</span><span>Value</span>
            </div>
            {rows.map(({def, value}) => (
              <div key={def.name} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-x-1.5 border-b border-border px-2 py-1.5 last:border-b-0">
                <span className="truncate font-mono text-xs" title={`${def.type}${def.default ? `, default ${def.default}` : ''}`}>
                  {def.name}{def.required && <span className="text-destructive"> *</span>}
                </span>
                <ExpressionInput nodeId={nodeId} label={`Value of ${def.name}`} value={value.value} expression={value.expression}
                                 placeholder={def.default ? `default: ${def.default}` : undefined}
                                 onValue={v => change(def.name, {value: v})} onExpression={e => change(def.name, {expression: e})}/>
              </div>
            ))}
            {rows.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">Its Start has no parameters</p>}
          </div>
        </section>
      )}

      {target && (
        <label className={cn('flex items-center gap-2 text-sm', !acceptsInput && 'opacity-50')}>
          <input type="checkbox" checked={sendEnvelope && acceptsInput} disabled={!acceptsInput}
                 onChange={e => setConfig('sendEnvelope', e.target.checked)} className="nodrag size-4"/>
          Send the envelope as input
        </label>
      )}
    </div>
  );
}

function WorkflowDocs() {
  return (
    <>
      <p>Runs another workflow per envelope, passing the parameters of its Start (text or expression).</p>
      <ul>
        <li><b>Send the envelope as input</b>: its <code>DATA</code> becomes the other flow&apos;s input.</li>
        <li>What reaches the other End comes back merged into the envelope (Override: only it).</li>
        <li>A failure is an error of the envelope: with Divert, the error port can call a handling workflow.</li>
        <li>A flow that calls itself is blocked; at most {MAX_WORKFLOW_DEPTH} levels.</li>
      </ul>
    </>
  );
}

export const WORKFLOW_INVOKER: ComponentDef = {
  type: workflowInvoker.type,
  label: 'Workflow Invoker',
  description: 'Calls another workflow with the parameters of its Start',
  category: 'flow',
  icon: Workflow,
  inputs: workflowInvoker.inputs,
  outputs: workflowInvoker.outputs,
  usesOverride: true,
  windowSize: {w: 620, h: 520},
  defaultConfig: {workflowId: '', parameters: [], sendEnvelope: false},
  Card: WorkflowCard,
  Panel: WorkflowPanel,
  Docs: WorkflowDocs,
  validate: (config: Config) => {
    const issues = workflowInvoker.validate(config);
    const {workflowId, parameters} = workflowInvokerConfig(config);
    const target = workflowId ? getFlow(workflowId) : undefined;
    if (workflowId && !target) return [...issues, 'calls a workflow that no longer exists.'];
    for (const p of target?.parameters ?? []) {
      const value = parameters.find(v => v.name === p.name)?.value ?? '';
      if (p.required && !value && !p.default) issues.push(`has no value for the required parameter "${p.name}".`);
    }
    return issues;
  },
};
