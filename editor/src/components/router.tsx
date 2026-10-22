import {Plus, Split, X} from 'lucide-react';
import {useReactFlow} from '@xyflow/react';
import {routerCases, routerElsePort, router, type RouterCase} from '@dataflow/core';
import {fieldInput} from '#ui/expression-field';
import {cn} from '#lib/utils';
import type {FieldsProps} from '#types/fields-props.type';
import type {ComponentDef} from '#types/component-def.type';
import type {Config} from '#types/config.type';

// Visual part of the Router. The logic (validate and execute) is the core's.

const caseLabel = (c: RouterCase, i: number) => c.label.trim() || `case ${i + 1}`;

function RouterCard({config}: FieldsProps) {
  const cases = routerCases(config);
  if (cases.length === 0) return <p className="text-xs italic text-muted-foreground">No cases</p>;
  return (
    <ul className="flex flex-col gap-1">
      {cases.slice(0, 6).map((c, i) => (
        <li key={i} className="flex min-w-0 items-baseline gap-1.5 font-mono text-xs">
          <span className="shrink-0 font-semibold">{caseLabel(c, i)}:</span>
          <span className="min-w-0 truncate text-primary" title={c.condition}>{c.condition || '?'}</span>
        </li>
      ))}
      {cases.length > 6 && <li className="text-xs text-muted-foreground">+{cases.length - 6} cases</li>}
    </ul>
  );
}

/**
 * Cases as a list (label + condition). The outputs follow the order of the cases and the else is the last one, so adding
 * or removing a case renumbers the edges leaving the Router so that each one stays on the same case.
 */
function RouterPanel({nodeId: id, config, setConfig}: FieldsProps) {
  const {setEdges} = useReactFlow();
  const cases = routerCases(config);
  const change = (i: number, update: Partial<RouterCase>) => setConfig('cases', cases.map((c, j) => (j === i ? {...c, ...update} : c)));

  function add() {
    const elseBefore = routerElsePort(config);
    setConfig('cases', [...cases, {label: '', condition: ''}]);
    setEdges(list => list.map(e => (e.source === id && e.sourceHandle === elseBefore ? {...e, sourceHandle: `out-${cases.length + 1}`} : e)));
  }

  function remove(i: number) {
    setConfig('cases', cases.filter((_, j) => j !== i));
    setEdges(list => list
      .filter(e => !(e.source === id && e.sourceHandle === `out-${i}`))
      .map(e => {
        const n = e.source === id ? Number(e.sourceHandle?.match(/^out-(\d+)$/)?.[1]) : NaN;
        return n > i ? {...e, sourceHandle: `out-${n - 1}`} : e;
      }));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col overflow-hidden rounded-md border border-border">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_32px] items-center gap-x-1.5 border-b border-border bg-muted/50 px-2 py-1.5 text-xs font-medium text-muted-foreground">
          <span>Output</span><span>Condition</span><span/>
        </div>
        {cases.map((c, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_32px] items-center gap-x-1.5 border-b border-border px-2 py-1.5">
            <input value={c.label} onChange={e => change(i, {label: e.target.value})} placeholder={`case ${i + 1}`}
                   aria-label={`Output name of case ${i + 1}`} className={fieldInput}/>
            <input value={c.condition} onChange={e => change(i, {condition: e.target.value})} placeholder='$state === "CA"' spellCheck={false}
                   aria-label={`Condition of case ${i + 1}`} className={cn(fieldInput, 'border-primary/50 bg-primary/5 font-mono')}/>
            <button type="button" onClick={() => remove(i)} aria-label={`Remove case ${i + 1}`}
                    className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
              <X className="size-4" aria-hidden="true"/>
            </button>
          </div>
        ))}
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_32px] items-center gap-x-1.5 px-2 py-2 text-xs text-muted-foreground">
          <span className="px-2 font-mono">else</span><span>no case was true</span><span/>
        </div>
      </div>
      <button type="button" onClick={add}
              className="flex h-8 items-center justify-center gap-1 rounded-md border border-dashed border-input text-xs text-muted-foreground hover:border-ring hover:text-foreground">
        <Plus className="size-3.5" aria-hidden="true"/> Add case
      </button>
    </div>
  );
}

function RouterDocs() {
  return (
    <>
      <p>Sends each envelope to the output of the first case whose condition is true, in list order. Does not touch <code>DATA</code>.</p>
      <h4>Input</h4>
      <p>1 envelope port.</p>
      <h4>Outputs</h4>
      <p>One per case, in list order, with the case name next to the port, and <code>else</code> last, for the envelope where no case was true. The case outputs must be connected; <code>else</code> may stay unconnected, and what goes out through it is dropped.</p>
      <h4>Condition</h4>
      <p>A JS expression, as in the Filter: <code>$PARAMETERS</code>, <code>$WORKFLOW_CURRENT_RUN</code> and each envelope field are available. E.g.: <code>{'$state === "CA"'}</code>, <code>{'["WA", "OR", "CA"].includes($state)'}</code>.</p>
      <p>An envelope goes out through a single output: if two cases are true, the top one wins.</p>
      <h4>Disabled</h4>
      <p>Every envelope goes out through the first output.</p>
      <h4>Errors</h4>
      <p>A condition that fails is an error of the envelope and follows the card's "On error" policy.</p>
    </>
  );
}

export const ROUTER: ComponentDef = {
  type: router.type,
  label: 'Router',
  description: 'Sends each envelope to the first true case',
  category: 'transformation',
  icon: Split,
  inputs: router.inputs,
  outputs: router.outputs,
  outputsFromConfig: (config: Config) => [...routerCases(config).map((c, i) => ({label: caseLabel(c, i)})), {label: 'else'}],
  optionalOutputs: router.optionalOutputs,
  defaultConfig: {cases: [{label: '', condition: ''}]},
  Card: RouterCard,
  Panel: RouterPanel,
  Docs: RouterDocs,
  validate: config => router.validate(config),
};
