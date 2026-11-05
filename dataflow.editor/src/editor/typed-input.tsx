import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Plus, Trash } from 'lucide-react';
import { emptyOfShape, inputTypeRef, scriptImports, scriptTypeShape, inputIssues, needsFilling, unionValue, type TypeShape } from '@dataflow/core';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { loadScriptContent, useProjectScripts } from '@/data/scripts/scripts-store';
import { ProjectResourcesContext } from './project-resources';

/*
 * MOCK: a Start's input typed by a project script's type. The picker lists the types (never functions or values) the
 * project's scripts export; with one chosen, the default input is a form of that type (the core reads the type:
 * scriptTypeShape), kept in sync with its JSON, which is still what is stored and what a test run sends.
 */

const SELECT = 'h-8 w-full rounded-md border bg-transparent px-2 text-sm';
const INPUT = 'h-8 w-full min-w-0 rounded-md border bg-transparent px-2 text-sm';

/** the types a project's scripts export, to pick one as `path#Name` (empty: none, the input is plain JSON) */
export function ScriptTypePicker({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const { projectId } = useContext(ProjectResourcesContext);
  const project = useProjectScripts(projectId);
  const types = project.scripts.flatMap(s => s.exports.filter(e => e.typeOnly).map(e => ({ path: s.path, name: e.name })));
  const chosen = inputTypeRef(value);
  const missing = chosen && !types.some(t => t.path === chosen.path && t.name === chosen.name);
  return (
    <select id={id} value={value} className={SELECT} onChange={event => onChange(event.target.value)}>
      <option value="">None (JSON)</option>
      {missing && <option value={value}>{`${chosen.name} (${chosen.path})`}</option>}
      {[...new Set(types.map(t => t.path))].map(path => (
        <optgroup key={path} label={path}>
          {types
            .filter(t => t.path === path)
            .map(t => (
              <option key={t.name} value={`${t.path}#${t.name}`}>
                {t.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

/** the scripts a type may need (its own and what it imports, in turn) loaded, then its shape */
function useTypeShape(typeRef: string): { shape: TypeShape | null; loading: boolean } {
  const { projectId } = useContext(ProjectResourcesContext);
  const project = useProjectScripts(projectId);
  const sources = useMemo(() => Object.fromEntries(Object.entries(project.contents).map(([path, content]) => [path, content.code])), [project.contents]);
  // what is still to load: the type's script, then whatever the loaded ones import
  const wanted = useMemo(() => {
    const ref = inputTypeRef(typeRef);
    if (!ref) {
      return [];
    }

    const paths = new Set([ref.path]);
    for (const code of Object.values(sources)) {
      scriptImports(code).forEach(path => paths.add(path));
    }

    return [...paths].filter(path => !(path in sources) && project.scripts.some(s => s.path === path));
  }, [typeRef, sources, project]);
  useEffect(() => {
    wanted.forEach(path => void loadScriptContent(projectId, path));
  }, [projectId, wanted]);
  const ref = inputTypeRef(typeRef);
  const shape = useMemo(() => {
    const chosen = inputTypeRef(typeRef);
    return chosen ? scriptTypeShape(sources, chosen.path, chosen.name) : null;
  }, [typeRef, sources]);
  return { shape, loading: !!ref && !(ref.path in sources) };
}

/** the JSON as a value, or undefined when it is not valid JSON */
const parsed = (text: string): unknown => {
  try {
    return text.trim() ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The default input with a type: Form (one control per field, built from the type) or JSON (the code editor, as without
 * a type); both edit the same JSON.
 */
export function TypedInputSetting(props: { id: string; typeRef: string; value: string; onChange: (value: string) => void; json: ReactNode }) {
  const { id, typeRef, value, onChange, json } = props;
  const { shape, loading } = useTypeShape(typeRef);
  const [view, setView] = useState<'form' | 'json'>('form');
  const current = parsed(value);
  const invalid = value.trim() !== '' && current === undefined;
  const empty = shape ? JSON.stringify(emptyOfShape(shape), null, 2) : null;
  // what the server would refuse the run for (the same check)
  const issues = shape && current !== undefined ? inputIssues(current, shape) : [];
  // a type chosen: the default input starts as its empty value right away (saved with the rest); another type chosen
  // later replaces it only while it is still the one filled in here, untouched (what was typed stays: Reset clears it).
  // Only when the type changes: never while it is being edited (cleared to paste something else, half typed)
  const filled = useRef<string | null>(null);
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange };
  });
  useEffect(() => {
    const { value: now, onChange: change } = latest.current;
    if (empty !== null && empty !== now && (now.trim() === '' || now === filled.current)) {
      filled.current = empty;
      change(empty);
    }
  }, [empty]);
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <Label htmlFor={id}>Default input</Label>
        {view === 'form' && empty !== null && value !== empty && (
          <button type="button" title="Start over from the type's empty value" className="ml-auto rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => onChange(empty)}>
            Reset
          </button>
        )}
        <div role="radiogroup" aria-label="Default input view" className={cn('flex gap-1', (view !== 'form' || empty === null || value === empty) && 'ml-auto')}>
          {(['form', 'json'] as const).map(v => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={view === v}
              onClick={() => setView(v)}
              className={cn('rounded-md px-2 py-0.5 text-xs uppercase', view === v ? 'bg-accent font-medium' : 'text-muted-foreground hover:text-foreground')}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      {view === 'json' ? (
        json
      ) : loading ? (
        <p className="text-xs text-muted-foreground">Loading the type…</p>
      ) : !shape ? (
        <p className="text-xs text-destructive">The script no longer exports this type.</p>
      ) : invalid ? (
        <p className="text-xs text-destructive">The input is not valid JSON: fix it in the JSON view.</p>
      ) : Array.isArray(current) && shape.kind !== 'array' && shape.kind !== 'tuple' ? (
        // a list: one envelope per item, each one of the type (checked below); the form edits one, so the JSON view
        <p className="text-xs text-muted-foreground">
          A list of {current.length} envelope(s), each one {inputTypeRef(typeRef)?.name}: edit it in the JSON view.
        </p>
      ) : (
        <div id={id} className="grid gap-3 rounded-md border p-3">
          <ShapeControl id={id} shape={shape} value={current ?? emptyOfShape(shape)} onChange={next => onChange(JSON.stringify(next, null, 2))} />
        </div>
      )}
      {issues.length > 0 && (
        <ul aria-label="Input issues" className="grid gap-1 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {issues.map(issue => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** one value of a shape: its control (an object: its fields; a list: its items with Add and Remove) */
function ShapeControl({ id, shape, value, onChange }: { id: string; shape: TypeShape; value: unknown; onChange: (value: unknown) => void }) {
  switch (shape.kind) {
    case 'string':
      return <input id={id} className={INPUT} value={typeof value === 'string' ? value : ''} onChange={event => onChange(event.target.value)} />;
    case 'number':
      return (
        <input
          id={id}
          type="number"
          className={INPUT}
          value={typeof value === 'number' ? value : ''}
          onChange={event => onChange(event.target.value === '' ? 0 : Number(event.target.value))}
        />
      );
    case 'boolean':
      return (
        <div role="radiogroup" className="flex h-8 items-center gap-4 text-sm">
          {[true, false].map(option => (
            <label key={String(option)} className="flex cursor-pointer items-center gap-1.5">
              <input type="radio" name={id} aria-label={String(option)} checked={value === option} className="size-4 accent-primary" onChange={() => onChange(option)} />
              {String(option)}
            </label>
          ))}
        </div>
      );
    case 'enum':
      return (
        <select
          id={id}
          className={SELECT}
          value={JSON.stringify(value ?? null)}
          onChange={event => onChange(JSON.parse(event.target.value))}
        >
          {!shape.options.some(o => o === value) && <option value={JSON.stringify(value ?? null)}>{value === undefined || value === null ? '—' : String(value)}</option>}
          {shape.options.map(option => (
            <option key={String(option)} value={JSON.stringify(option)}>
              {String(option)}
            </option>
          ))}
        </select>
      );
    case 'array':
      return <ArrayControl id={id} of={shape.of} items={Array.isArray(value) ? value : []} onChange={onChange} />;
    case 'tuple':
      return <TupleControl id={id} items={shape.items} value={Array.isArray(value) ? value : []} onChange={onChange} />;
    case 'record':
      return <RecordControl id={id} of={shape.of} value={value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}} onChange={onChange} />;
    case 'union':
      return <UnionControl id={id} shape={shape} value={value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}} onChange={onChange} />;
    case 'object':
      return <ObjectControl id={id} shape={shape} value={value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}} onChange={onChange} />;
    case 'json':
      return <JsonValueControl id={id} value={value} onChange={onChange} />;
  }
}

/** whether a shape takes a block of its own (below its name, indented) */
const isBlock = (shape: TypeShape) => ['object', 'array', 'record', 'union', 'tuple'].includes(shape.kind);

/** an object's fields, one per line (a nested object or a list below its name); an optional one can be left out */
function ObjectControl(props: { id: string; shape: { fields: Extract<TypeShape, { kind: 'object' }>['fields'] }; value: Record<string, unknown>; onChange: (value: unknown) => void }) {
  const { id, shape, value, onChange } = props;
  return (
    <div className="grid gap-3">
      {shape.fields.map(field => {
        const fieldId = `${id}-${field.name}`;
        const present = field.name in value;
        const block = isBlock(field.shape);
        const set = (next: unknown) => onChange({ ...value, [field.name]: next });
        return (
          <div key={field.name} className={cn('grid gap-1.5', block && 'rounded-md border-l-2 pl-3')}>
            <div className="flex items-center gap-2 text-xs">
              <label htmlFor={fieldId} className="font-mono font-medium">
                {field.name}
              </label>
              {/* a list or a record is not marked: it always goes, [] or {} until items are added (the core's rule) */}
              {needsFilling(field) && (
                <span className="text-destructive" title="Required" aria-label="Required">
                  *
                </span>
              )}
              {field.optional && (
                <label className="ml-auto flex cursor-pointer items-center gap-1 text-muted-foreground">
                  <input
                    type="checkbox"
                    aria-label={`Send ${field.name}`}
                    checked={present}
                    className="size-3.5 accent-primary"
                    onChange={event => {
                      if (event.target.checked) {
                        set(emptyOfShape(field.shape));
                      } else {
                        const { [field.name]: _gone, ...rest } = value;
                        onChange(rest);
                      }
                    }}
                  />
                  Send
                </label>
              )}
            </div>
            {(present || !field.optional) && <ShapeControl id={fieldId} shape={field.shape} value={value[field.name] ?? emptyOfShape(field.shape)} onChange={set} />}
          </div>
        );
      })}
    </div>
  );
}

/** a list's items, each with Remove, and Add at the end */
function ArrayControl({ id, of, items, onChange }: { id: string; of: TypeShape; items: unknown[]; onChange: (value: unknown) => void }) {
  return (
    <div className="grid gap-2">
      {items.map((item, index) => (
        <div key={index} role="group" aria-label={`Item ${index + 1}`} className={cn('flex items-start gap-2', isBlock(of) && 'rounded-md border p-2')}>
          <div className="min-w-0 flex-1">
            <ShapeControl id={`${id}-${index}`} shape={of} value={item} onChange={next => onChange(items.map((old, i) => (i === index ? next : old)))} />
          </div>
          <button
            type="button"
            aria-label={`Remove item ${index + 1}`}
            title="Remove"
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => onChange(items.filter((_, i) => i !== index))}
          >
            <Trash className="size-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="flex h-7 w-fit items-center gap-1 rounded-md border px-2 text-xs hover:bg-accent"
        onClick={() => onChange([...items, emptyOfShape(of)])}
      >
        <Plus className="size-3.5" /> Add item
      </button>
    </div>
  );
}

/** a value the form has no control for (any, a record...): its JSON, applied once it is valid */
function JsonValueControl({ id, value, onChange }: { id: string; value: unknown; onChange: (value: unknown) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value ?? null));
  const valid = parsed(text) !== undefined;
  return (
    <textarea
      id={id}
      rows={2}
      spellCheck={false}
      aria-invalid={!valid || undefined}
      className={cn('w-full rounded-md border bg-transparent px-2 py-1 font-mono text-xs', !valid && 'border-destructive')}
      value={text}
      onChange={event => {
        setText(event.target.value);
        const next = parsed(event.target.value);
        if (next !== undefined) {
          onChange(next);
        }
      }}
    />
  );
}

/** a tuple's positions, each with its own control, in order */
function TupleControl({ id, items, value, onChange }: { id: string; items: TypeShape[]; value: unknown[]; onChange: (value: unknown) => void }) {
  return (
    <div className="grid gap-2">
      {items.map((item, index) => (
        <div key={index} className="flex items-start gap-2">
          <label htmlFor={`${id}-${index}`} className="w-8 shrink-0 pt-2 text-right font-mono text-xs text-muted-foreground">
            [{index}]
          </label>
          <div className="min-w-0 flex-1">
            <ShapeControl
              id={`${id}-${index}`}
              shape={item}
              value={value[index] ?? emptyOfShape(item)}
              onChange={next => onChange(items.map((shape, i) => (i === index ? next : (value[i] ?? emptyOfShape(shape)))))}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** a record's entries: a key and its value each, with Remove, and Add entry at the end (keys stay unique) */
function RecordControl({ id, of, value, onChange }: { id: string; of: TypeShape; value: Record<string, unknown>; onChange: (value: unknown) => void }) {
  const entries = Object.entries(value);
  const rename = (from: string, to: string) => onChange(Object.fromEntries(entries.map(([k, v]) => [k === from ? to : k, v])));
  const freeKey = () => {
    let n = entries.length + 1;
    while (`key${n}` in value) {
      n += 1;
    }

    return `key${n}`;
  };
  return (
    <div className="grid gap-2">
      {entries.map(([key, item], index) => (
        <div key={index} role="group" aria-label={`Entry ${index + 1}`} className={cn('flex items-start gap-2', isBlock(of) && 'rounded-md border p-2')}>
          <input
            aria-label={`Key of entry ${index + 1}`}
            className={cn(INPUT, 'w-32 shrink-0 font-mono')}
            value={key}
            onChange={event => {
              if (!(event.target.value in value)) {
                rename(key, event.target.value);
              }
            }}
          />
          <div className="min-w-0 flex-1">
            <ShapeControl id={`${id}-${index}`} shape={of} value={item} onChange={next => onChange({ ...value, [key]: next })} />
          </div>
          <button
            type="button"
            aria-label={`Remove entry ${index + 1}`}
            title="Remove"
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => onChange(Object.fromEntries(entries.filter(([k]) => k !== key)))}
          >
            <Trash className="size-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="flex h-7 w-fit items-center gap-1 rounded-md border px-2 text-xs hover:bg-accent"
        onClick={() => onChange({ ...value, [freeKey()]: emptyOfShape(of) })}
      >
        <Plus className="size-3.5" /> Add entry
      </button>
    </div>
  );
}

/** a discriminated union: its tag as a choice, then the fields of the variant chosen (another one starts empty) */
function UnionControl(props: { id: string; shape: Extract<TypeShape, { kind: 'union' }>; value: Record<string, unknown>; onChange: (value: unknown) => void }) {
  const { id, shape, value, onChange } = props;
  const variant = shape.variants.find(v => v.value === value[shape.tag]) ?? shape.variants[0];
  if (!variant) {
    return null;
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-${shape.tag}`} className="font-mono text-xs font-medium">
          {shape.tag}
        </label>
        <select
          id={`${id}-${shape.tag}`}
          className={SELECT}
          value={JSON.stringify(variant.value)}
          onChange={event => onChange(unionValue(shape, JSON.parse(event.target.value)))}
        >
          {shape.variants.map(v => (
            <option key={String(v.value)} value={JSON.stringify(v.value)}>
              {String(v.value)}
            </option>
          ))}
        </select>
      </div>
      <ObjectControl id={id} shape={{ fields: variant.fields }} value={value} onChange={onChange} />
    </div>
  );
}
