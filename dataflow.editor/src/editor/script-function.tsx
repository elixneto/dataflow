import { useContext, useEffect, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { inputTypeRef, scriptFunctions, type ExportedFunction, type ExpressionField, type ScriptArgument } from '@dataflow/core';
import { loadScriptContent, useProjectScripts } from '@/data/scripts/scripts-store';
import { ProjectResourcesContext } from './project-resources';

/*
 * A Script Invoker's settings: the function it calls (one a project script exports, `path#name`) and its arguments,
 * one row per parameter of that function, in its order (the call passes them by position).
 */

const SELECT = 'h-8 w-full rounded-md border bg-transparent px-2 text-sm';

/** the functions the project's scripts export (`export function`), grouped by script, as `path#name` */
export function ScriptFunctionPicker({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const { projectId } = useContext(ProjectResourcesContext);
  const project = useProjectScripts(projectId);
  const functions = project.scripts.flatMap(s => s.exports.filter(e => e.function).map(e => ({ path: s.path, name: e.name })));
  const chosen = inputTypeRef(value);
  const missing = chosen && !functions.some(f => f.path === chosen.path && f.name === chosen.name);
  return (
    <select id={id} value={value} className={SELECT} onChange={event => onChange(event.target.value)}>
      <option value="">{functions.length ? 'Choose a function' : 'No script exports a function'}</option>
      {missing && <option value={value}>{`${chosen.name} (${chosen.path}, missing)`}</option>}
      {[...new Set(functions.map(f => f.path))].map(path => (
        <optgroup key={path} label={path}>
          {functions
            .filter(f => f.path === path)
            .map(f => (
              <option key={f.name} value={`${f.path}#${f.name}`}>
                {f.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

export type CalledFunction = { status: 'loading' } | { status: 'missing' } | { status: 'ready'; fn: ExportedFunction };

/** the function `path#name` names, read from its script (loaded when needed, read again when it changes) */
export function useScriptFunction(ref: string): CalledFunction {
  const { projectId } = useContext(ProjectResourcesContext);
  const project = useProjectScripts(projectId);
  const target = inputTypeRef(ref);
  const path = target?.path ?? '';
  const known = !!target && project.scripts.some(s => s.path === target.path);
  useEffect(() => {
    if (path && known) void loadScriptContent(projectId, path);
  }, [projectId, path, known]);
  if (!target || (project.status === 'ready' && !known)) return { status: 'missing' };
  const code = project.contents[target.path]?.code;
  if (code === undefined) return { status: 'loading' };
  const fn = scriptFunctions(code).find(f => f.name === target.name);
  return fn ? { status: 'ready', fn } : { status: 'missing' };
}

/** the arguments for the function's parameters, in its order, each with the value already given for it (by name) */
export function argumentsFor(fn: ExportedFunction, items: ScriptArgument[]): ScriptArgument[] {
  return fn.params.map(p => {
    const given = items.find(item => item.name === p.name);
    return { name: p.name, type: p.type, value: given?.value ?? '', expression: given?.expression ?? false };
  });
}

/** whether the arguments kept are the function's parameters, in its order (a changed function shifts them) */
const inStep = (fn: ExportedFunction, items: ScriptArgument[]) =>
  items.length === fn.params.length && fn.params.every((p, i) => items[i]?.name === p.name && (items[i]?.type ?? '') === p.type);

/**
 * One row per parameter of the function (its type, whether it is optional), each a fixed value or an expression; empty:
 * undefined (its default applies). Kept arguments that no longer match the function: a note, and a button to match it.
 */
export function ScriptArgumentsSetting(props: {
  id: string;
  fn: ExportedFunction;
  items: ScriptArgument[];
  onChange: (items: ScriptArgument[]) => void;
  renderValue: (id: string, value: ExpressionField, placeholder: string, onChange: (value: ExpressionField) => void) => ReactNode;
}) {
  const { id, fn, items, onChange, renderValue } = props;
  const rows = argumentsFor(fn, items);
  const stale = items.length > 0 && !inStep(fn, items);
  const gone = items.filter(item => !fn.params.some(p => p.name === item.name));
  const set = (name: string, value: ExpressionField) => onChange(rows.map(row => (row.name === name ? { ...row, ...value } : row)));

  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1.5 text-sm leading-none font-medium">Arguments</legend>
      {stale && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-500">
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            The function's parameters changed{gone.length ? ` (${gone.map(g => g.name).join(', ')} no longer there)` : ''}: the call still sends the arguments as they were.{' '}
            <button type="button" className="underline" onClick={() => onChange(rows)}>
              Match the function
            </button>
          </span>
        </p>
      )}
      {fn.params.length === 0 && <p className="text-xs text-muted-foreground">The function takes no arguments.</p>}
      {rows.map((row, index) => {
        const param = fn.params[index]!;
        const empty = row.expression ? !row.value.trim() : row.value === '';
        return (
          <div key={row.name} role="group" aria-label={`argument ${row.name}`} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-1.5">
            <div className="grid min-h-8 min-w-0 content-center">
              <span className="truncate font-mono text-sm" title={row.name}>
                {param.rest ? '...' : ''}
                {row.name}
              </span>
              <span className="truncate text-xs text-muted-foreground" title={param.type || 'any'}>
                {param.type || 'any'}
                {!param.optional && (
                  <>
                    {' · '}
                    <span className={empty ? 'text-destructive' : undefined} title={empty ? 'Required: give it a value' : 'Required'}>
                      required
                    </span>
                  </>
                )}
              </span>
            </div>
            {renderValue(`${id}-${index}`, row, param.optional ? 'optional' : '', value => set(row.name, value))}
          </div>
        );
      })}
    </fieldset>
  );
}
