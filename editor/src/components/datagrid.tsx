import type {ClipboardEvent} from 'react';
import {Plus, Table, X} from 'lucide-react';
import {dataGridConfig, datagrid, cellValue, type DataGridColumn, type ParameterType} from '@dataflow/core';
import {KeyInput, fieldInput} from '#ui/expression-field';
import {cn} from '#lib/utils';
import type {FieldsProps} from '#types/fields-props.type';
import type {ComponentDef} from '#types/component-def.type';

// Visual part of the Data Grid. The logic is the core's.

function DataGridCard({config}: FieldsProps) {
  const {columns, rows} = dataGridConfig(config);
  if (columns.length === 0) return <p className="text-xs italic text-muted-foreground">No columns</p>;
  return (
    <div className="flex flex-col gap-1 font-mono text-xs">
      <p className="truncate font-semibold" title={columns.map(c => c.name).join(', ')}>{columns.map(c => c.name || '?').join(', ')}</p>
      <p className="text-muted-foreground">{rows.length} row(s)</p>
    </div>
  );
}

const TYPES: [ParameterType, string][] = [['text', 'Text'], ['number', 'Number'], ['boolean', 'Boolean']];

/** Text pasted from Excel/a spreadsheet: rows by line break, columns by tab. */
function readPasted(text: string) {
  return text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map(l => l.split('\t'));
}

/**
 * Editable grid: a header with the name and type of each column, one row per envelope. Pasting several Excel cells into a
 * cell fills from it (and creates the missing rows and columns); pasting into a column name uses the first row as
 * names and the rest as the grid's rows.
 */
function DataGridPanel({config, setConfig}: FieldsProps) {
  const {columns, rows} = dataGridConfig(config);

  const setColumns = (next: DataGridColumn[]) => setConfig('columns', next);
  const setRows = (next: string[][]) => setConfig('rows', next);
  const changeColumn = (j: number, update: Partial<DataGridColumn>) => setColumns(columns.map((c, k) => (k === j ? {...c, ...update} : c)));
  const changeCell = (i: number, j: number, value: string) =>
    setRows(rows.map((r, k) => (k === i ? Array.from({length: columns.length}, (_, m) => (m === j ? value : r[m] ?? '')) : r)));
  const removeColumn = (j: number) => {
    setColumns(columns.filter((_, k) => k !== j));
    setRows(rows.map(r => r.filter((_, k) => k !== j)));
  };
  /** columns missing to fit `count` starting at `start` */
  const withColumns = (start: number, count: number) =>
    [...columns, ...Array.from({length: Math.max(0, start + count - columns.length)}, () => ({name: '', type: 'text' as const}))];

  function pasteIntoCell(e: ClipboardEvent<HTMLInputElement>, i: number, j: number) {
    const text = e.clipboardData.getData('text');
    if (!/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return;
    e.preventDefault();
    const pasted = readPasted(text);
    const nextColumns = withColumns(j, Math.max(...pasted.map(r => r.length)));
    const nextRows = [...rows];
    pasted.forEach((cells, di) => {
      const row = [...(nextRows[i + di] ?? [])];
      cells.forEach((v, dj) => (row[j + dj] = v));
      nextRows[i + di] = Array.from({length: nextColumns.length}, (_, m) => row[m] ?? '');
    });
    setColumns(nextColumns);
    setRows(nextRows);
  }

  function pasteIntoHeader(e: ClipboardEvent<HTMLInputElement>, j: number) {
    const text = e.clipboardData.getData('text');
    if (!/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return;
    e.preventDefault();
    const [names, ...rest] = readPasted(text);
    const nextColumns = withColumns(j, names.length).map((c, k) => (k >= j && k < j + names.length ? {...c, name: names[k - j].trim()} : c));
    setColumns(nextColumns);
    if (rest.length) setRows(rest.map(cells => Array.from({length: nextColumns.length}, (_, m) => (m >= j ? cells[m - j] ?? '' : ''))));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-auto rounded-md border border-border">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="w-8 border-b border-border"/>
              {columns.map((c, j) => (
                <th key={j} className="min-w-40 border-b border-l border-border p-1.5 text-left font-normal">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1">
                      <KeyInput value={c.name} onValue={name => changeColumn(j, {name})} label={`Name of column ${j + 1}`} placeholder="column"
                                onPaste={e => pasteIntoHeader(e, j)}
                                className="flex-1"/>
                      <button type="button" onClick={() => removeColumn(j)} aria-label={`Remove column ${j + 1}`}
                              className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                        <X className="size-4" aria-hidden="true"/>
                      </button>
                    </div>
                    <select value={c.type} onChange={e => changeColumn(j, {type: e.target.value as ParameterType})} aria-label={`Type of column ${j + 1}`}
                            className={cn(fieldInput, 'w-full')}>
                      {TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </div>
                </th>
              ))}
              <th className="w-10 border-b border-l border-border p-1.5">
                <button type="button" onClick={() => {
                  setColumns([...columns, {name: '', type: 'text'}]);
                  setRows(rows.map(r => [...r, '']));
                }} aria-label="Add column" title="Add column"
                        className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                  <Plus className="size-4" aria-hidden="true"/>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-border last:border-b-0">
                <td className="text-center font-mono text-muted-foreground">{i + 1}</td>
                {columns.map((c, j) => {
                  const invalid = cellValue(row[j], c.type) === undefined;
                  return (
                    <td key={j} className="border-l border-border p-1">
                      <input value={row[j] ?? ''} onChange={e => changeCell(i, j, e.target.value)} onPaste={e => pasteIntoCell(e, i, j)}
                             aria-label={`Row ${i + 1}, ${c.name || `column ${j + 1}`}`} aria-invalid={invalid}
                             className={cn(fieldInput, c.type !== 'text' && 'font-mono', c.type === 'number' && 'text-right',
                               invalid && 'border-destructive focus-visible:border-destructive')}/>
                    </td>
                  );
                })}
                <td className="border-l border-border p-1">
                  <button type="button" onClick={() => setRows(rows.filter((_, k) => k !== i))} aria-label={`Remove row ${i + 1}`}
                          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                    <X className="size-4" aria-hidden="true"/>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {columns.length > 0 && rows.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">No rows</p>}
      </div>
      {columns.length > 0 && (
        <button type="button" onClick={() => setRows([...rows, columns.map(() => '')])}
                className="flex h-8 items-center justify-center gap-1 rounded-md border border-dashed border-input text-xs text-muted-foreground hover:border-ring hover:text-foreground">
          <Plus className="size-3.5" aria-hidden="true"/> Add row
        </button>
      )}
    </div>
  );
}

function DataGridDocs() {
  return (
    <>
      <p>A table typed into the component itself: emits one envelope per row, with each column written into the envelope (like the Mapper).</p>
      <p>Useful for mappings (e.g. source system code → target value, connected to the Lookup's <code>lookup</code> input) and for testing a flow without needing input.</p>
      <h4>Input</h4>
      <p>1 envelope port, usually connected to the Start. For each incoming envelope, the whole grid goes out again: the Start emits one envelope, so as many envelopes go out as there are rows.</p>
      <h4>Output</h4>
      <p>One envelope per row, with the DATA of the incoming envelope plus the columns. The next components read each column as <code>$column</code>.</p>
      <h4>Types</h4>
      <p>Text goes as is. Number accepts a decimal comma (<code>1,5</code>). Boolean accepts <code>true</code>/<code>false</code>, <code>yes</code>/<code>no</code> and <code>1</code>/<code>0</code>. An empty cell becomes <code>null</code>. A cell that does not convert turns red and blocks the run.</p>
      <h4>Paste from Excel</h4>
      <p>Copy the cells in the spreadsheet and paste them into a grid cell: it fills from there and creates the missing rows and columns. Pasting into a column name, the first row becomes the column names and the rest, the rows.</p>
      <h4>Override</h4>
      <p>On, the output envelope carries only the grid's columns.</p>
    </>
  );
}

export const DATA_GRID: ComponentDef = {
  type: datagrid.type,
  label: 'Data Grid',
  description: 'A typed table that emits one envelope per row',
  category: 'source',
  icon: Table,
  inputs: datagrid.inputs,
  outputs: datagrid.outputs,
  noError: true,
  usesOverride: true,
  windowSize: {w: 760, h: 560},
  defaultConfig: {columns: [{name: '', type: 'text'}], rows: [['']]},
  Card: DataGridCard,
  Panel: DataGridPanel,
  Docs: DataGridDocs,
  validate: config => datagrid.validate(config),
};
