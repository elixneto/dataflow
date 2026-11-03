import {Plus, X} from 'lucide-react';
import {nameIssue, type WorkflowParameter, type ParameterType} from '@dataflow/core';
import {fieldInput} from '#ui/expression-field';

const TYPES: {value: ParameterType; label: string}[] = [
  {value: 'text', label: 'Text'},
  {value: 'number', label: 'Number'},
  {value: 'boolean', label: 'Yes/no'},
];

function jsonError(text: string) {
  if (!text.trim()) return null;
  try {
    JSON.parse(text);
    return null;
  } catch (e) {
    return `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/**
 * Start panel: the parameters the workflow expects. Each trigger (endpoint, schedule) passes the values;
 * whatever is missing uses the default. In expressions: $PARAMETERS.name.
 */
export function WorkflowPanel({parameters, onChange, acceptsInput, onAcceptsInput, testInput, onTestInput}: {
  parameters: WorkflowParameter[];
  onChange: (parameters: WorkflowParameter[]) => void;
  acceptsInput: boolean;
  onAcceptsInput: (yes: boolean) => void;
  testInput: string;
  onTestInput: (json: string) => void;
}) {
  const inputError = jsonError(testInput);
  const change = (i: number, update: Partial<WorkflowParameter>) => onChange(parameters.map((p, j) => (j === i ? {...p, ...update} : p)));
  const names = parameters.map(p => p.name);

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 [&>*]:shrink-0">
        <section className="flex flex-col gap-2 rounded-md border border-border p-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={acceptsInput} onChange={e => onAcceptsInput(e.target.checked)} className="size-4"/>
            Accepts input
          </label>
          {acceptsInput && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="test-input" className="text-xs font-medium text-muted-foreground">Default input (JSON)</label>
              <textarea id="test-input" value={testInput} onChange={e => onTestInput(e.target.value)} spellCheck={false}
                        placeholder={'{"id": "123"}'}
                        className="min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"/>
              {inputError && <span className="text-xs text-destructive">{inputError}</span>}
            </div>
          )}
        </section>


        {parameters.map((p, i) => {
          const issue = nameIssue(p.name) ?? (names.indexOf(p.name) !== i ? `"${p.name}" is repeated` : null);
          return (
            <div key={i} className="flex flex-col gap-2 rounded-md border border-border p-3">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-xs text-muted-foreground">$PARAMETERS.</span>
                <input value={p.name} onChange={e => change(i, {name: e.target.value})} placeholder="name"
                       aria-label={`Name of parameter ${i + 1}`} className={`${fieldInput} font-mono`}/>
                <button type="button" onClick={() => onChange(parameters.filter((_, j) => j !== i))} aria-label="Remove parameter"
                        className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                  <X className="size-4" aria-hidden="true"/>
                </button>
              </div>
              {issue && <span className="text-xs text-destructive">{issue}</span>}
              <div className="grid grid-cols-[110px_1fr] gap-2">
                <select value={p.type} onChange={e => change(i, {type: e.target.value as ParameterType})} className={fieldInput} aria-label="Type">
                  {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                {p.type === 'boolean' ? (
                  <select value={p.default} onChange={e => change(i, {default: e.target.value})} className={fieldInput} aria-label="Default value">
                    <option value="false">No</option>
                    <option value="true">Yes</option>
                  </select>
                ) : (
                  <input value={p.default} onChange={e => change(i, {default: e.target.value})} placeholder="default value"
                         inputMode={p.type === 'number' ? 'decimal' : undefined} aria-label="Default value" className={fieldInput}/>
                )}
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-xs">
                <input type="checkbox" checked={p.required ?? false} onChange={e => change(i, {required: e.target.checked})} className="size-3.5"/>
                Required
              </label>
            </div>
          );
        })}

        <button type="button" onClick={() => onChange([...parameters, {name: '', type: 'text', default: ''}])}
                className="flex h-9 items-center justify-center gap-1 rounded-md border border-dashed border-input text-sm text-muted-foreground hover:border-ring hover:text-foreground">
          <Plus className="size-4" aria-hidden="true"/> Add parameter
        </button>
      </div>
    </>
  );
}
