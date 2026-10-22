import {useRef, useState, type PointerEvent} from 'react';
import {ArrowRight, Plus, Shuffle, X} from 'lucide-react';
import {mapperFields, mapper, type MapperField} from '@dataflow/core';
import {KeyInput, ExpressionInput} from '#ui/expression-field';
import type {FieldsProps} from '#types/fields-props.type';
import type {ComponentDef} from '#types/component-def.type';

// Visual part of the Mapper. The logic (validate and execute) is the core's.

function MapperCard({config}: FieldsProps) {
  const fields = mapperFields(config);
  if (fields.length === 0) return <p className="text-xs italic text-muted-foreground">No keys</p>;
  return (
    <ul className="flex flex-col gap-1">
      {fields.slice(0, 4).map((f, i) => (
        <li key={i} className="flex min-w-0 items-baseline gap-1.5 font-mono text-xs">
          <span className="shrink-0 font-semibold">{f.target || '?'}:</span>
          <span className={f.expression ? 'min-w-0 truncate text-primary' : 'min-w-0 truncate text-muted-foreground'} title={f.value}>
            {f.expression ? f.value : `"${f.value}"`}
          </span>
        </li>
      ))}
      {fields.length > 4 && <li className="text-xs text-muted-foreground">+{fields.length - 4} keys</li>}
    </ul>
  );
}

const COLUMN_KEY = 'dataflow-mapper-source-column';

function readSourceWidth() {
  try {
    const v = Number(localStorage.getItem(COLUMN_KEY));
    return v >= 20 && v <= 85 ? v : 60;
  } catch {
    return 60;
  }
}

/** Source → target table. The header divider resizes the columns (remembered in the browser). */
function MapperPanel({config, setConfig}: FieldsProps) {
  const fields = mapperFields(config);
  const change = (i: number, update: Partial<MapperField>) => setConfig('fields', fields.map((f, j) => (j === i ? {...f, ...update} : f)));
  const [sourcePct, setSourcePct] = useState(readSourceWidth);
  const tableRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  function moveDivider(e: PointerEvent<HTMLDivElement>) {
    if (!dragging.current || !tableRef.current) return;
    const r = tableRef.current.getBoundingClientRect();
    const pct = Math.min(Math.max(((e.clientX - r.left) / r.width) * 100, 20), 85);
    setSourcePct(pct);
  }

  function releaseDivider() {
    dragging.current = false;
    try {
      localStorage.setItem(COLUMN_KEY, String(Math.round(sourcePct)));
    } catch {
      // no storage: only lasts until reload
    }
  }

  const columns = {gridTemplateColumns: `minmax(0, ${sourcePct}fr) 16px minmax(0, ${100 - sourcePct}fr) 32px`};

  return (
    <div className="flex flex-col gap-3">
      <div ref={tableRef} className="flex flex-col overflow-hidden rounded-md border border-border">
        <div className="grid items-center gap-x-1.5 border-b border-border bg-muted/50 px-2 py-1.5 text-xs font-medium text-muted-foreground" style={columns}>
          <span>Source (value)</span>
          {/* divider between the columns (in the arrow column): drag to resize, double-click goes back to the default */}
          <div role="separator" aria-orientation="vertical" aria-label="Resize columns"
               onPointerDown={e => {
                 dragging.current = true;
                 e.currentTarget.setPointerCapture(e.pointerId);
               }}
               onPointerMove={moveDivider} onPointerUp={releaseDivider} onDoubleClick={() => setSourcePct(60)}
               className="group flex h-5 cursor-col-resize touch-none justify-center">
            <span className="h-full w-px bg-border group-hover:w-0.5 group-hover:bg-primary"/>
          </div>
          <span>Key in the envelope</span>
          <span/>
        </div>
        {fields.map((f, i) => (
          <div key={i} className="grid items-center gap-x-1.5 border-b border-border px-2 py-1.5 last:border-b-0" style={columns}>
            <ExpressionInput label={`Source of row ${i + 1}`} value={f.value} expression={f.expression}
                             onValue={value => change(i, {value})} onExpression={expression => change(i, {expression})}/>
            <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true"/>
            <KeyInput value={f.target} onValue={target => change(i, {target})} label={`Key in the envelope of row ${i + 1}`}/>
            <button type="button" onClick={() => setConfig('fields', fields.filter((_, j) => j !== i))} aria-label={`Remove row ${i + 1}`}
                    className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
              <X className="size-4" aria-hidden="true"/>
            </button>
          </div>
        ))}
        {fields.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">No rows</p>}
      </div>
      <button type="button" onClick={() => setConfig('fields', [...fields, {target: '', value: '', expression: true}])}
              className="flex h-8 items-center justify-center gap-1 rounded-md border border-dashed border-input text-xs text-muted-foreground hover:border-ring hover:text-foreground">
        <Plus className="size-3.5" aria-hidden="true"/> Add row
      </button>
    </div>
  );
}

function MapperDocs() {
  return (
    <>
      <p>Writes fields directly into the envelope: each row takes a value (source) to a field (target), adding the field or replacing the value if it already exists.</p>
      <h4>Input</h4>
      <p>1 envelope port. Each incoming envelope goes through the Mapper once.</p>
      <h4>Output</h4>
      <p>The same envelopes, with the fields written into the envelope. The next components read each field as <code>$target</code>.</p>
      <h4>Source</h4>
      <p>Plain text, or a JS expression with the <code>=</code> on. In the expression, <code>$PARAMETERS</code>, <code>$WORKFLOW_CURRENT_RUN</code> and each field of the incoming envelope (<code>$field</code>) are available.</p>
      <p>E.g.: <code>{'"PINEAPPLE"'}</code> → <code>field</code> and, in a following Mapper, <code>{'$field + " 123"'}</code> → <code>otherField</code> give <code>{'{field: "PINEAPPLE", otherField: "PINEAPPLE 123"}'}</code>.</p>
      <p>The rows are evaluated on the incoming envelope: a row does not see what another row of the same Mapper writes.</p>
      <h4>Override</h4>
      <p>On, the output envelope carries only this Mapper's fields.</p>
      <h4>Errors</h4>
      <p>An expression that fails (e.g. a field that does not exist) is an error of the envelope and follows the card's "On error" policy. With Divert, the envelope goes out through the error port with <code>{'$errors: [{error, message, component}]'}</code>.</p>
    </>
  );
}

export const MAPPER: ComponentDef = {
  type: mapper.type,
  label: 'Mapper',
  description: 'Writes fields into the envelope (source → target)',
  category: 'transformation',
  icon: Shuffle,
  inputs: mapper.inputs,
  outputs: mapper.outputs,
  usesOverride: true,
  defaultConfig: {fields: [{target: '', value: '', expression: true}]},
  Card: MapperCard,
  Panel: MapperPanel,
  Docs: MapperDocs,
  validate: config => mapper.validate(config),
};
