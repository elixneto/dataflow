import { createContext, lazy, Suspense, useContext, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { ArrowDown, ArrowRight, ArrowUp, LoaderCircle, Plus, Trash } from 'lucide-react';
import { callPath, DYNAMIC_CONNECTION, DYNAMIC_TARGET, inputTypeRef, settingDefault, settingsDefaults, settingValue, settingVisible, withSetting, type ExpressionField, type ScriptArgument, type SettingField } from '@dataflow/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { projectTabPath } from '@/app/paths';
import { cn } from '@/lib/utils';
import { useProjectResources } from './project-resources';
import { ExpressionBox } from './expression-box';
import { loadCodeEditor } from './code-editor-loader';
import { ScriptTypePicker, TypedInputSetting } from './typed-input';
import { CalledFlowSetting, useCalledStart, type InvokerParameter } from './called-flow';
import { useProjectCalls } from './project-calls';
import { ScriptArgumentsSetting, ScriptFunctionPicker, useScriptFunction } from './script-function';

type Values = Record<string, unknown>;

/** the component whose settings these are: its expression fields suggest what reaches it */
const NodeContext = createContext<string | undefined>(undefined);

/** Monaco, only when a code setting shows */
const CodeEditor = lazy(loadCodeEditor);

const SELECT = 'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/30';

/**
 * A component's settings, built from what the core declares (ComponentLogic.settings): one control per kind of
 * setting, the `when`s applied. It only edits `values` (the window's draft config): Save, Cancel and the issues are
 * the window's.
 */
export function SettingsForm(props: { id: string; nodeId?: string; fields: SettingField[]; values: Values; onChange: (values: Values) => void }) {
  const { id, nodeId, fields, values, onChange } = props;
  return (
    <NodeContext.Provider value={nodeId}>
      <div className="grid gap-4">
        {fields
          .filter(field => settingVisible(field, values, fields))
          .map(field =>
            field.kind === 'grid' ? (
              // a table: its columns in the setting's key, its rows beside them (`rows`)
              <GridSetting
                key={field.key}
                id={`${id}-${field.key}`}
                field={field}
                columns={Array.isArray(values[field.key]) ? (values[field.key] as GridColumn[]) : []}
                rows={Array.isArray(values.rows) ? (values.rows as string[][]) : []}
                onChange={(columns, rows) => onChange({ ...values, [field.key]: columns, rows })}
              />
            ) : field.typedBy && inputTypeRef(values[field.typedBy]) ? (
              // MOCK: a JSON typed by a project script's type (a Start's input): a form of that type, or the JSON
              <TypedInputSetting
                key={field.key}
                id={`${id}-${field.key}`}
                typeRef={String(values[field.typedBy])}
                value={typeof values[field.key] === 'string' ? (values[field.key] as string) : ''}
                onChange={value => onChange(withSetting(field, values, value))}
                json={<Control id={`${id}-${field.key}-json`} field={field} value={settingValue(field, values)} onChange={value => onChange(withSetting(field, values, value))} />}
              />
            ) : field.parametersOf && typeof values[field.parametersOf] === 'string' && values[field.parametersOf] && values[field.parametersOf] !== DYNAMIC_TARGET ? (
              // a Flow Invoker's parameters: the called flow's Start parameters, one row each
              <CalledFlowParameters
                key={field.key}
                id={`${id}-${field.key}`}
                field={field}
                flowId={String(values[field.parametersOf])}
                values={values}
                onChange={items => onChange(withSetting(field, values, items))}
              />
            ) : field.argumentsOf ? (
              // a Script Invoker's arguments: the called function's parameters, one row each
              <ScriptArguments
                key={field.key}
                id={`${id}-${field.key}`}
                field={field}
                target={typeof values[field.argumentsOf] === 'string' ? String(values[field.argumentsOf]) : ''}
                values={values}
                onChange={items => onChange(withSetting(field, values, items))}
              />
            ) : (
              <Setting key={field.key} id={`${id}-${field.key}`} field={field} value={settingValue(field, values)} onChange={value => onChange(withSetting(field, values, value))} />
            ),
          )}
      </div>
    </NodeContext.Provider>
  );
}

/**
 * The arguments a Script Invoker passes to the function it calls: a row per parameter of that function. No function
 * chosen yet, nothing; while its script loads, a note; a function that cannot be read, the plain list.
 */
function ScriptArguments(props: { id: string; field: SettingField; target: string; values: Values; onChange: (items: ScriptArgument[]) => void }) {
  const { id, field, target, values, onChange } = props;
  const called = useScriptFunction(target);
  const items = Array.isArray(values[field.key]) ? (values[field.key] as ScriptArgument[]) : [];
  if (!target) {
    return null;
  }

  if (called.status === 'loading') {
    return <p className="text-xs text-muted-foreground">Reading the script…</p>;
  }

  if (called.status === 'missing') {
    return <Setting id={id} field={field} value={items} onChange={value => onChange(value as ScriptArgument[])} />;
  }

  return (
    <ScriptArgumentsSetting
      id={id}
      fn={called.fn}
      items={items}
      onChange={onChange}
      renderValue={(valueId, value, placeholder, change) => (
        <ValueControl id={valueId} field={{ key: 'value', label: 'Value', kind: 'value' }} value={value} placeholder={placeholder} onChange={change} />
      )}
    />
  );
}

/**
 * The parameters a Flow Invoker passes to the flow it calls: a row per parameter of that flow's Start, and the input it
 * takes. While its Start loads, nothing; a flow that cannot be read, the plain list (names typed by hand).
 */
function CalledFlowParameters(props: { id: string; field: SettingField; flowId: string; values: Values; onChange: (items: InvokerParameter[]) => void }) {
  const { id, field, flowId, values, onChange } = props;
  const start = useCalledStart(flowId);
  const { projectId = '', flowId: selfId } = useParams();
  // a chain from the called flow back to this one: each call would fail (the same calls the top bar's Calls shows)
  const project = useProjectCalls(projectId);
  const back = selfId && project ? callPath(project.calls.filter(c => c.from !== selfId), flowId, selfId) : null;
  const names = new Map(project?.flows.map(f => [f.id, f.name]));
  const cycle = back && selfId ? [selfId, ...back].map(id => names.get(id) ?? id) : undefined;
  const items = Array.isArray(values[field.key]) ? (values[field.key] as InvokerParameter[]) : [];
  if (start.status === 'loading') {
    return <p className="text-xs text-muted-foreground">Reading the flow…</p>;
  }

  if (start.status === 'missing') {
    return <Setting id={id} field={field} value={items} onChange={value => onChange(value as InvokerParameter[])} />;
  }

  return (
    <CalledFlowSetting
      id={id}
      start={start}
      items={items}
      sendEnvelope={values.sendEnvelope === true}
      cycle={cycle}
      onChange={onChange}
      renderValue={(valueId, value, placeholder, change) => (
        <ValueControl id={valueId} field={{ key: 'value', label: 'Value', kind: 'value' }} value={value} placeholder={placeholder} onChange={change} />
      )}
    />
  );
}

function Setting({ id, field, value, onChange }: { id: string; field: SettingField; value: unknown; onChange: (value: unknown) => void }) {
  if (field.kind === 'list') {
    const list = Array.isArray(value) ? (value as unknown[]) : [];
    // a flat list (Distinct's keys) holds the values themselves: each one is edited as an item with its single setting
    const key = field.item?.[0]?.key ?? 'value';
    return field.flat ? (
      <ListSetting id={id} field={field} items={list.map(v => ({ [key]: v }))} onChange={items => onChange(items.map(item => item[key]))} />
    ) : (
      <ListSetting id={id} field={field} items={list as Values[]} onChange={onChange} />
    );
  }

  if (field.kind === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input id={id} type="checkbox" checked={value === true} className="size-4 accent-primary" onChange={event => onChange(event.target.checked)} />
        {field.label}
      </label>
    );
  }

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{field.label}</Label>
      <Control id={id} field={field} value={value} onChange={onChange} />
    </div>
  );
}

/** the control of one setting, without its label (a list's items show the labels once, above the columns) */
function Control({ id, field, value, onChange }: { id: string; field: SettingField; value: unknown; onChange: (value: unknown) => void }) {
  const nodeId = useContext(NodeContext);
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  switch (field.kind) {
    case 'select':
      return (
        <select id={id} value={text} className={SELECT} onChange={event => onChange(event.target.value)}>
          {field.options?.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    case 'number':
      return (
        <Input
          id={id}
          type="number"
          min={field.min}
          max={field.max}
          value={text}
          placeholder={field.placeholder}
          onChange={event => onChange(event.target.value === '' ? '' : Number(event.target.value))}
        />
      );
    case 'expression':
      return <NodeExpressionBox id={id} value={text} placeholder={field.placeholder} onChange={onChange} />;
    case 'code': {
      // while the code editor (Monaco) loads: its frame, empty (nothing to type in, nothing typed is lost)
      const loading = (
        <div id={id} aria-label={`${field.label} (loading)`} className="flex h-72 items-center justify-center rounded-lg border border-input text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
        </div>
      );
      return (
        <Suspense fallback={loading}>
          <CodeEditor id={id} nodeId={nodeId} value={text} language={field.language ?? 'javascript'} label={field.label} onChange={onChange} />
        </Suspense>
      );
    }
    case 'value':
      return <ValueControl id={id} field={field} value={value} onChange={onChange} />;
    case 'boolean':
      // inside a list (a parameter's Required): the box alone, the label is the column's
      return (
        <span className="flex h-8 items-center">
          <input id={id} type="checkbox" aria-label={field.label} checked={value === true} className="size-4 accent-primary" onChange={event => onChange(event.target.checked)} />
        </span>
      );
    case 'connection':
      return <ConnectionPicker id={id} types={field.connectionTypes ?? [field.connectionType ?? '']} dynamic={field.connectionDynamic === true} value={text} onChange={onChange} />;
    case 'secret':
      return <SecretPicker id={id} value={text} onChange={onChange} />;
    case 'script-function':
      return <ScriptFunctionPicker id={id} value={text} onChange={onChange} />;
    case 'script-type':
      return <ScriptTypePicker id={id} value={text} onChange={onChange} />;
    case 'flow':
      return <FlowPicker id={id} value={text} onChange={onChange} />;
    default:
      return (
        <Input
          id={id}
          value={text}
          placeholder={field.placeholder}
          spellCheck={false}
          onChange={event => onChange(event.target.value)}
        />
      );
  }
}

/**
 * One of the project's connection profiles of the type, or none (then the component's own fields below apply), or (when
 * `dynamic`) one named in the run by an expression. A new
 * connection is made on the project's Connections tab (in a new tab, so the flow stays as it is); it shows up here when
 * this window comes back into focus.
 */
function ConnectionPicker({ id, types, dynamic, value, onChange }: { id: string; types: string[]; dynamic: boolean; value: string; onChange: (value: string) => void }) {
  const resources = useProjectResources();
  const profiles = resources.connections.filter(c => types.includes(c.type));
  const known = profiles.some(p => p.id === value) || (dynamic && value === DYNAMIC_CONNECTION);
  return (
    <div className="flex items-center gap-2">
      <select id={id} value={value} className={SELECT} onFocus={resources.refresh} onChange={event => onChange(event.target.value)}>
        <option value="">None (set it here)</option>
        {dynamic && <option value={DYNAMIC_CONNECTION}>By name (expression)</option>}
        {profiles.map(profile => (
          <option key={profile.id} value={profile.id}>
            {profile.name}
          </option>
        ))}
        {value && !known && <option value={value}>Missing connection</option>}
      </select>
      <NewLink href={projectTabPath(resources.projectId, 'connections')}>New connection</NewLink>
    </div>
  );
}

/** one of the project's secrets, by name (its value is never here) */
function SecretPicker({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const resources = useProjectResources();
  return (
    <div className="flex items-center gap-2">
      <select id={id} value={value} className={cn(SELECT, 'font-mono')} onFocus={resources.refresh} onChange={event => onChange(event.target.value)}>
        <option value="">Choose a secret</option>
        {resources.secrets.map(name => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
        {value && !resources.secrets.includes(value) && <option value={value}>{value} (missing)</option>}
      </select>
      <NewLink href={projectTabPath(resources.projectId, 'secrets')}>New secret</NewLink>
    </div>
  );
}

/** another flow of the project (not this one), or one named in the run by an expression (its whole path) */
function FlowPicker({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const resources = useProjectResources();
  const { flowId } = useParams();
  const flows = resources.flows.filter(f => f.id !== flowId);
  return (
    <select id={id} value={value} className={SELECT} onFocus={resources.refresh} onChange={event => onChange(event.target.value)}>
      <option value="">Choose a flow</option>
      <option value={DYNAMIC_TARGET}>By path (expression)</option>
      {flows.map(flow => (
        <option key={flow.id} value={flow.id}>
          {flow.name}
        </option>
      ))}
      {value && value !== DYNAMIC_TARGET && !flows.some(f => f.id === value) && <option value={value}>Missing flow</option>}
    </select>
  );
}

type GridColumn = { name: string; type: string };

/** a Data Grid: columns (name and type) across the top, one row of text cells per record; add and remove both */
function GridSetting(props: { id: string; field: SettingField; columns: GridColumn[]; rows: string[][]; onChange: (columns: GridColumn[], rows: string[][]) => void }) {
  const { id, field, columns, rows, onChange } = props;
  const types = field.options ?? [];
  const template = { gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, minmax(7rem, 1fr)) 1.5rem` };
  const setColumn = (index: number, column: GridColumn) => onChange(columns.map((c, i) => (i === index ? column : c)), rows);
  const setCell = (row: number, column: number, text: string) =>
    onChange(
      columns,
      rows.map((cells, i) => (i === row ? columns.map((_, j) => (j === column ? text : (cells[j] ?? ''))) : cells)),
    );

  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1.5 text-sm leading-none font-medium">{field.label}</legend>
      <div className="overflow-x-auto">
        <div className="grid min-w-max gap-1.5">
          {columns.length > 0 && (
            <div role="row" className="grid items-center gap-1.5" style={template}>
              {columns.map((column, j) => (
                <div key={j} role="columnheader" className="grid gap-1 rounded-lg bg-muted/50 p-1">
                  <div className="flex items-center gap-1">
                    <Input
                      aria-label={`Column ${j + 1} name`}
                      id={j === 0 ? id : undefined}
                      value={column.name}
                      placeholder={`column${j + 1}`}
                      spellCheck={false}
                      className="h-7 font-mono"
                      onChange={event => setColumn(j, { ...column, name: event.target.value })}
                    />
                    <IconButton
                      label={`Remove column ${column.name || j + 1}`}
                      onClick={() => onChange(columns.filter((_, i) => i !== j), rows.map(cells => cells.filter((_, i) => i !== j)))}
                    >
                      <Trash />
                    </IconButton>
                  </div>
                  <select aria-label={`Column ${j + 1} type`} value={column.type} className={cn(SELECT, 'h-7')} onChange={event => setColumn(j, { ...column, type: event.target.value })}>
                    {types.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <span />
            </div>
          )}
          {columns.length > 0 &&
            rows.map((cells, i) => (
              <div key={i} role="row" aria-label={`row ${i + 1}`} className="grid items-center gap-1.5" style={template}>
                {columns.map((column, j) => (
                  <Input
                    key={j}
                    aria-label={`Row ${i + 1}, ${column.name || `column ${j + 1}`}`}
                    value={cells[j] ?? ''}
                    className="h-7"
                    onChange={event => setCell(i, j, event.target.value)}
                  />
                ))}
                <IconButton label={`Remove row ${i + 1}`} onClick={() => onChange(columns, rows.filter((_, r) => r !== i))}>
                  <Trash />
                </IconButton>
              </div>
            ))}
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange([...columns, { name: '', type: types[0]?.value ?? 'text' }], rows.map(cells => [...cells, '']))}
        >
          <Plus /> Add column
        </Button>
        <Button variant="outline" size="sm" disabled={columns.length === 0} onClick={() => onChange(columns, [...rows, columns.map(() => '')])}>
          <Plus /> Add row
        </Button>
      </div>
    </fieldset>
  );
}

function NewLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 text-xs text-primary hover:underline">
      <Plus className="size-3" aria-hidden />
      {children}
    </a>
  );
}

/** an expression field of this form's component: it suggests what reaches the component (expression-box.tsx) */
function NodeExpressionBox({ id, value, placeholder, onChange }: { id: string; value: string; placeholder?: string; onChange: (value: string) => void }) {
  return <ExpressionBox id={id} nodeId={useContext(NodeContext)} value={value} placeholder={placeholder} onChange={onChange} />;
}

/** a fixed value or an expression: the fx button switches (an expression in monospace) */
function ValueControl(props: { id: string; field: SettingField; value: unknown; placeholder?: string; onChange: (value: ExpressionField) => void }) {
  const { id, field, value, placeholder, onChange } = props;
  const current = (value && typeof value === 'object' ? value : settingDefault(field)) as ExpressionField;
  return (
    <div className="flex items-start gap-1">
      <button
        type="button"
        aria-label="Expression"
        title={current.expression ? 'Expression (click for a fixed value)' : 'Fixed value (click for an expression)'}
        aria-pressed={current.expression}
        onClick={() => onChange({ ...current, expression: !current.expression })}
        className={cn(
          'flex h-8 shrink-0 items-center rounded-lg border px-1.5 font-mono text-xs italic transition-colors',
          current.expression ? 'border-primary/40 bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        fx
      </button>
      {current.expression ? (
        <div className="grid min-w-0 flex-1 gap-1">
          <NodeExpressionBox id={id} value={current.value} placeholder={placeholder ?? field.placeholder} onChange={text => onChange({ ...current, value: text })} />
        </div>
      ) : (
        <Input id={id} value={current.value} placeholder={placeholder} onChange={event => onChange({ ...current, value: event.target.value })} />
      )}
    </div>
  );
}

/** a list (a Mapper's fields, a Router's cases): one row per item, its settings side by side; add, remove, reorder */
function ListSetting({ id, field, items, onChange }: { id: string; field: SettingField; items: Values[]; onChange: (items: Values[]) => void }) {
  const itemFields = field.item ?? [];
  const widths = itemFields.map(f => ({ text: 'minmax(0, 2fr)', select: 'minmax(0, 1.5fr)', number: 'minmax(0, 1fr)', boolean: 'auto' })[f.kind as string] ?? 'minmax(0, 3fr)');
  // a list that takes its first setting to the second (a Mapper): an arrow column between them, as in the PoC
  const arrow = Boolean(field.arrow) && itemFields.length >= 2;
  const columns = { gridTemplateColumns: (arrow ? [widths[0], '1rem', ...widths.slice(1)] : widths).join(' ') + ' auto' };
  const between = (index: number, cell: ReactNode) =>
    arrow && index === 1 ? [<span key="arrow" aria-hidden className="flex h-8 items-center justify-center text-muted-foreground"><ArrowRight className="size-4" /></span>, cell] : [cell];
  const set = (index: number, item: Values) => onChange(items.map((current, i) => (i === index ? item : current)));
  const move = (index: number, by: number) => {
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item as Values);
    onChange(next);
  };

  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1.5 text-sm leading-none font-medium">{field.label}</legend>
      {items.length > 0 && (
        <div className="grid gap-1.5 text-xs text-muted-foreground" style={columns} aria-hidden>
          {itemFields.flatMap((f, i) => (arrow && i === 1 ? [<span key="arrow" />, <span key={f.key}>{f.label}</span>] : [<span key={f.key}>{f.label}</span>]))}
          <span className="w-[4.5rem]" />
        </div>
      )}
      {items.map((item, index) => (
        <div key={index} role="group" aria-label={`${field.itemLabel ?? 'item'} ${index + 1}`} className="grid items-start gap-1.5" style={columns}>
          {itemFields.flatMap((f, i) =>
            between(
              i,
              settingVisible(f, item, itemFields) ? (
                <Control
                  key={f.key}
                  id={`${id}-${index}-${f.key}`}
                  field={f}
                  value={settingValue(f, item)}
                  onChange={value => set(index, withSetting(f, item, value))}
                />
              ) : (
                <span key={f.key} />
              ),
            ),
          )}
          <div className="flex h-8 items-center">
            <IconButton label="Move up" disabled={index === 0} onClick={() => move(index, -1)}>
              <ArrowUp />
            </IconButton>
            <IconButton label="Move down" disabled={index === items.length - 1} onClick={() => move(index, 1)}>
              <ArrowDown />
            </IconButton>
            <IconButton label={`Remove ${field.itemLabel ?? 'item'}`} onClick={() => onChange(items.filter((_, i) => i !== index))}>
              <Trash />
            </IconButton>
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" className="justify-self-start" onClick={() => onChange([...items, settingsDefaults(itemFields)])}>
        <Plus /> Add {field.itemLabel ?? 'item'}
      </Button>
    </fieldset>
  );
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30 [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}
