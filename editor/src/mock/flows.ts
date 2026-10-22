import type {Edge} from '@xyflow/react';
import type {WorkflowParameter} from '@dataflow/core';
import {END, START} from '#components/catalog';
import type {CommentNode} from '#editor/comment-node';
import type {GroupNode} from '#editor/group-node';
import type {ComponentNode} from '#editor/component-node';
import {EXAMPLES_PROJECT} from '#mock/projects';

/*
 * Mock flows, stored in the browser's localStorage. When the backend exists, this becomes API calls
 * and the flows move to the database.
 */

export type FlowNode = ComponentNode | CommentNode | GroupNode;

export type Flow = {
  id: string;
  /** project that owns the flow (an old flow without a project goes to the examples one) */
  projectId?: string;
  /** folder inside the project, as a path ("Sales/Invoices"); empty = root */
  folder?: string;
  name: string;
  description: string;
  status: 'draft' | 'published';
  version: number;
  updatedAt: string;
  /** parameters the workflow expects (each trigger passes the values; whatever is missing uses the default) */
  parameters?: WorkflowParameter[];
  nodes: FlowNode[];
  edges: Edge[];
};

const KEY = 'dataflow-flows-v1';

function component(id: string, type: string, label: string, x: number, y: number, config: Record<string, unknown> = {}): ComponentNode {
  return {id, type: 'component', position: {x, y}, data: {type, label, config}};
}

export function emptyFlow(projectId: string, folder = ''): Flow {
  return {
    id: 'f-' + Date.now().toString(36), projectId, folder, name: 'New flow', description: '', status: 'draft', version: 0,
    updatedAt: new Date().toISOString(),
    parameters: [],
    nodes: [
      component(START, START, 'Start', 0, 100),
      component(END, END, 'End', 900, 100),
    ],
    edges: [],
  };
}

// ---------- Fixed examples: recreated on every load (whatever is changed in them is not kept) ----------

export const EXAMPLE_ID = 'example-errors';

const EXAMPLE_ITEMS = Array.from({length: 10}, (_, i) => {
  const id = i + 1;
  // items 3 and 7 come without a price: Mapper 1 fails on them and they go to the error port
  return id === 3 || id === 7 ? {id, name: `Item ${id}`} : {id, name: `Item ${id}`, price: id * 10.5};
});

function withOverride(node: ComponentNode): ComponentNode {
  return {...node, data: {...node.data, override: true}};
}

function withKey(node: ComponentNode, outputKey: string): ComponentNode {
  return {...node, data: {...node.data, outputKey}};
}

function connect(source: string, target: string, output = 'out-0', input = 'in-0'): Edge {
  return {id: `e-${source}-${output}-${target}-${input}`, source, sourceHandle: output, target, targetHandle: input};
}

/** List of 10 items → Mapper 1 (2 fail and are diverted) → Mapper 2 handles the error → Union → End. */
function exampleFlow(): Flow {
  return {
    id: EXAMPLE_ID, name: 'Example: diverted errors', status: 'draft', version: 0, updatedAt: new Date().toISOString(),
    description: '10 items; 2 without a price fail in Mapper 1, are diverted, handled in Mapper 2 and joined in the Union before the End.',
    parameters: [],
    nodes: [
      component(START, START, 'Start', 0, 200, {acceptsInput: true, testInput: JSON.stringify(EXAMPLE_ITEMS, null, 2)}),
      component('mapper1', 'mapper', 'Mapper 1', 320, 120, {
        onError: 'divert',
        fields: [{target: 'formattedPrice', value: '"$ " + $price.toFixed(2)', expression: true}],
      }),
      withOverride(component('mapper2', 'mapper', 'Mapper 2', 660, 380, {
        fields: [{target: 'id', value: '$id', expression: true}, {target: 'status', value: 'ERROR', expression: false}],
      })),
      component('union', 'union', 'Union', 1000, 160, {inputCount: 2}),
      component(END, END, 'End', 1340, 200),
    ],
    edges: [
      connect(START, 'mapper1'),
      connect('mapper1', 'union', 'out-0', 'in-0'),
      connect('mapper1', 'mapper2', 'error', 'in-0'),
      connect('mapper2', 'union', 'out-0', 'in-1'),
      connect('union', END),
    ],
  };
}

export const FILTER_EXAMPLE_ID = 'example-filter';

/** List of 10 items → Filter ($price > 50) → a Mapper on each output → Union → End. */
function filterExampleFlow(): Flow {
  const range = (id: string, label: string, x: number, y: number, value: string) =>
    component(id, 'mapper', label, x, y, {fields: [{target: 'range', value, expression: false}]});
  const items = Array.from({length: 10}, (_, i) => ({id: i + 1, name: `Item ${i + 1}`, price: (i + 1) * 10.5}));
  return {
    id: FILTER_EXAMPLE_ID, name: 'Example: Filter', status: 'draft', version: 0, updatedAt: new Date().toISOString(),
    description: '10 items; the Filter separates those priced above 50 (true) from the others (false), each side gets its range and the Union joins everything.',
    parameters: [],
    nodes: [
      component(START, START, 'Start', 0, 200, {acceptsInput: true, testInput: JSON.stringify(items, null, 2)}),
      component('filter', 'filter', 'Filter', 320, 160, {condition: '$price > 50'}),
      range('expensive', 'Expensive', 700, 40, 'EXPENSIVE'),
      range('cheap', 'Cheap', 700, 300, 'CHEAP'),
      component('union', 'union', 'Union', 1080, 160, {inputCount: 2}),
      component(END, END, 'End', 1420, 200),
    ],
    edges: [
      connect(START, 'filter'),
      connect('filter', 'expensive', 'out-0'),
      connect('filter', 'cheap', 'out-1'),
      connect('expensive', 'union', 'out-0', 'in-0'),
      connect('cheap', 'union', 'out-0', 'in-1'),
      connect('union', END),
    ],
  };
}

export const ROUTER_EXAMPLE_ID = 'example-router';

/** 10 companies → Router by state (CA, West Coast, else) → a Mapper per output writes the region → Union → End. */
function routerExampleFlow(): Flow {
  const states = ['CA', 'OR', 'TX', 'CA', 'WA', 'NY', 'OR', 'CA', 'FL', 'WA'];
  const companies = states.map((state, i) => ({id: i + 1, name: `Company ${i + 1}`, state}));
  const region = (id: string, label: string, x: number, y: number, value: string) =>
    component(id, 'mapper', label, x, y, {fields: [{target: 'region', value, expression: false}]});
  return {
    id: ROUTER_EXAMPLE_ID, name: 'Example: Router', status: 'draft', version: 0, updatedAt: new Date().toISOString(),
    description: '10 companies; the Router separates CA, the rest of the West Coast and everything else (else), each output writes the region and the Union joins everything.',
    parameters: [],
    nodes: [
      component(START, START, 'Start', 0, 220, {acceptsInput: true, testInput: JSON.stringify(companies, null, 2)}),
      component('router', 'router', 'Router by state', 320, 180, {cases: [
        {label: 'CA', condition: '$state === "CA"'},
        {label: 'West', condition: '["OR", "WA"].includes($state)'},
      ]}),
      region('ca', 'California', 720, 20, 'CA'),
      region('west', 'West', 720, 220, 'WEST'),
      region('others', 'Others', 720, 420, 'OTHERS'),
      component('union', 'union', 'Union', 1100, 200, {inputCount: 3}),
      component(END, END, 'End', 1440, 240),
    ],
    edges: [
      connect(START, 'router'),
      connect('router', 'ca', 'out-0'),
      connect('router', 'west', 'out-1'),
      connect('router', 'others', 'out-2'),
      connect('ca', 'union', 'out-0', 'in-0'),
      connect('west', 'union', 'out-0', 'in-1'),
      connect('others', 'union', 'out-0', 'in-2'),
      connect('union', END),
    ],
  };
}

export const LOOKUP_EXAMPLE_ID = 'example-lookup';

/**
 * Tickets and companies arrive together at the Start; the Router separates the companies (lookup) from the tickets (main)
 * and the Lookup writes into each ticket the company found by code ($company); the Mapper takes the id and the name.
 * Code 99 does not exist: $company stays null and the Mapper uses the default.
 */
function lookupExampleFlow(): Flow {
  const companies = [
    {kind: 'company', code: 10, id: 'co-alpha', name: 'Alpha Inc.'},
    {kind: 'company', code: 20, id: 'co-beta', name: 'Beta LLC'},
    {kind: 'company', code: 30, id: 'co-gamma', name: 'Gamma Co.'},
  ];
  const codes = [10, 20, 30, 10, 99, 20, 10, 30];
  const tickets = codes.map((companyCode, i) => ({kind: 'ticket', id: i + 1, date: `2026-10-${String(i + 1).padStart(2, '0')}`, companyCode}));
  return {
    id: LOOKUP_EXAMPLE_ID, name: 'Example: Lookup', status: 'draft', version: 0, updatedAt: new Date().toISOString(),
    description: '8 tickets and 3 companies; the Lookup finds the company of each ticket by code and the Mapper takes the id and the name (99 does not exist and gets the default).',
    parameters: [],
    nodes: [
      component(START, START, 'Start', 0, 200, {acceptsInput: true, testInput: JSON.stringify([...tickets, ...companies], null, 2)}),
      component('split', 'router', 'Company or ticket?', 320, 160, {cases: [{label: 'company', condition: '$kind === "company"'}]}),
      withKey(component('lookup', 'lookup', 'Company of the ticket', 720, 160, {
        keys: [{main: '$companyCode', lookup: '$code'}],
        ifNotFound: 'null',
      }), 'company'),
      component('fields', 'mapper', 'Company fields', 1100, 160, {fields: [
        {target: 'companyId', value: '$company?.id ?? null', expression: true},
        {target: 'companyName', value: '$company?.name ?? "(no company)"', expression: true},
      ]}),
      component(END, END, 'End', 1480, 200),
    ],
    edges: [
      connect(START, 'split'),
      connect('split', 'lookup', 'out-1', 'in-0'),
      connect('split', 'lookup', 'out-0', 'in-1'),
      connect('lookup', 'fields'),
      connect('fields', END),
    ],
  };
}

export const TYPESCRIPT_EXAMPLE_ID = 'example-typescript';

const EXAMPLE_CODE = `type Order = {id: number; customer: string; items: {product: string; amount: number}[]}

async function process($input: {items: Order[]}): Promise<Data[]> {
  log(\`batch with \${$input.items.length} order(s)\`)
  return $input.items.map(order => ({
    id: order.id,
    customer: order.customer.toUpperCase(),
    total: total(order),
    range: total(order) > 100 ? 'HIGH' : 'LOW',
    source: $PARAMETERS.source,
  }))
}

function total(order: Order) {
  return order.items.reduce((sum, item) => sum + item.amount, 0)
}
`;

/** 7 orders → Aggregate (batches of 3) → TypeScript (total, range, upper-case customer and the source parameter) → End. */
function typescriptExampleFlow(): Flow {
  const orders = Array.from({length: 7}, (_, i) => ({
    id: i + 1, customer: `customer ${i + 1}`,
    items: Array.from({length: (i % 3) + 1}, (_, j) => ({product: `P${j + 1}`, amount: 25 * (i + j + 1)})),
  }));
  return {
    id: TYPESCRIPT_EXAMPLE_ID, name: 'Example: TypeScript', status: 'draft', version: 0, updatedAt: new Date().toISOString(),
    description: '7 orders; the Aggregate groups them in batches of 3 and the TypeScript process function computes the total of each order in the batch.',
    parameters: [{name: 'source', type: 'text', default: 'ERP'}],
    nodes: [
      component(START, START, 'Start', 0, 200, {acceptsInput: true, testInput: JSON.stringify(orders, null, 2)}),
      component('agg', 'aggregate', 'Batches of 3', 320, 190, {size: 3, field: 'items'}),
      withOverride(component('ts', 'typescript', 'Computes the total', 720, 180, {code: EXAMPLE_CODE})),
      component(END, END, 'End', 1120, 200),
    ],
    edges: [connect(START, 'agg'), connect('agg', 'ts'), connect('ts', END)],
  };
}

export const DATA_GRID_EXAMPLE_ID = 'example-data-grid';

/**
 * No input at the Start: the Copy sends the Start envelope to two Data Grids, one with the tickets (main) and
 * another with the company mapping (lookup), and the Lookup writes the company name into each ticket. Code 40 does not exist.
 */
function dataGridExampleFlow(): Flow {
  return {
    id: DATA_GRID_EXAMPLE_ID, name: 'Example: Data Grid and Copy', status: 'draft', version: 0, updatedAt: new Date().toISOString(),
    description: 'The Copy calls two Data Grids (5 tickets and the company mapping); the Lookup writes the company name into each ticket.',
    parameters: [],
    nodes: [
      component(START, START, 'Start', 0, 200),
      component('copy', 'copy', 'Copy', 260, 190, {outputCount: 2}),
      component('tickets', 'datagrid', 'Tickets', 560, 60, {
        columns: [{name: 'id', type: 'number'}, {name: 'date', type: 'text'}, {name: 'companyCode', type: 'number'}],
        rows: [['1', '2026-10-01', '10'], ['2', '2026-10-02', '20'], ['3', '2026-10-03', '10'], ['4', '2026-10-04', '30'], ['5', '2026-10-05', '40']],
      }),
      component('companies', 'datagrid', 'Company mapping', 560, 320, {
        columns: [{name: 'code', type: 'number'}, {name: 'name', type: 'text'}, {name: 'active', type: 'boolean'}],
        rows: [['10', 'Alpha Inc.', 'yes'], ['20', 'Beta LLC', 'yes'], ['30', 'Gamma Co.', 'no']],
      }),
      withKey(component('lookup', 'lookup', 'Company of the ticket', 940, 160, {
        keys: [{main: '$companyCode', lookup: '$code'}],
        ifNotFound: 'null',
      }), 'company'),
      component('fields', 'mapper', 'Company fields', 1320, 160, {fields: [
        {target: 'companyName', value: '$company?.name ?? "(no company)"', expression: true},
        {target: 'companyActive', value: '$company?.active ?? false', expression: true},
      ]}),
      component(END, END, 'End', 1700, 200),
    ],
    edges: [
      connect(START, 'copy'),
      connect('copy', 'tickets', 'out-0'),
      connect('copy', 'companies', 'out-1'),
      connect('tickets', 'lookup', 'out-0', 'in-0'),
      connect('companies', 'lookup', 'out-0', 'in-1'),
      connect('lookup', 'fields'),
      connect('fields', END),
    ],
  };
}

export const SQL_SERVER_EXAMPLE_ID = 'example-sql-server';

/** Lists the tables of any SQL Server database (secret MY_SQL_DB in runner/secrets.local.json). */
function sqlServerExampleFlow(): Flow {
  return {
    id: SQL_SERVER_EXAMPLE_ID, name: 'Example: SQL Server Query', status: 'draft', version: 0, updatedAt: new Date().toISOString(),
    description: 'Lists the tables of a SQL Server database (create the MY_SQL_DB secret with the connection string in the Secrets tab).',
    parameters: [{name: 'limit', type: 'number', default: '20'}],
    nodes: [
      component(START, START, 'Start', 0, 200),
      withOverride(component('tables', 'sqlserver', 'Database tables', 300, 170, {
        connection: 'MY_SQL_DB',
        sql: `SELECT TOP (@limit) name AS tableName, create_date AS createdAt
FROM sys.tables
ORDER BY name`,
        parameters: [{name: 'limit', value: '$PARAMETERS.limit', expression: true}],
        timeoutS: 60,
      })),
      component(END, END, 'End', 760, 200),
    ],
    edges: [connect(START, 'tables'), connect('tables', END)],
  };
}

export const INVOKER_EXAMPLE_ID = 'example-workflow-invoker';
const INVOKER_CALLED_EXAMPLE_ID = 'example-workflow-invoker-multiply';
const INVOKER_ERROR_EXAMPLE_ID = 'example-workflow-invoker-error-handling';

/**
 * Three workflows: the parent yields n = 1, 2, 3 and calls "Multiply" with times = n - 1; with times 0 it fails, and the error
 * port calls "Error handling" with the envelope.
 */
function invokerExampleFlows(): Flow[] {
  const now = new Date().toISOString();
  const multiply: Flow = {
    id: INVOKER_CALLED_EXAMPLE_ID, name: 'Example: Invoker (Multiply)', status: 'draft', version: 0, updatedAt: now,
    description: 'Called by "Example: Workflow Invoker": receives the envelope and multiplies n by the times parameter (times 0 fails).',
    parameters: [{name: 'times', type: 'number', default: '1', required: true}],
    nodes: [
      component(START, START, 'Start', 0, 200, {acceptsInput: true, testInput: '{"n": 5}'}),
      component('total', 'mapper', 'Total', 320, 180, {fields: [{
        target: 'total', expression: true,
        value: '$PARAMETERS.times > 0 ? $n * $PARAMETERS.times : (() => { throw new Error("times must be greater than zero") })()',
      }]}),
      component(END, END, 'End', 760, 200),
    ],
    edges: [connect(START, 'total'), connect('total', END)],
  };
  const handling: Flow = {
    id: INVOKER_ERROR_EXAMPLE_ID, name: 'Example: Invoker (Error handling)', status: 'draft', version: 0, updatedAt: now,
    description: 'Called by the error port of "Example: Workflow Invoker": receives the envelope that failed and marks it as handled.',
    parameters: [],
    nodes: [
      component(START, START, 'Start', 0, 200, {acceptsInput: true}),
      component('mark', 'mapper', 'Mark as handled', 320, 180, {fields: [{target: 'handled', value: 'true', expression: true}]}),
      component(END, END, 'End', 760, 200),
    ],
    edges: [connect(START, 'mark'), connect('mark', END)],
  };
  const parent: Flow = {
    id: INVOKER_EXAMPLE_ID, name: 'Example: Workflow Invoker', status: 'draft', version: 0, updatedAt: now,
    description: 'Calls "Multiply" for each number; whatever fails goes through the error port to "Error handling".',
    parameters: [],
    nodes: [
      component(START, START, 'Start', 0, 200),
      component('numbers', 'datagrid', 'Numbers', 260, 180, {columns: [{name: 'n', type: 'number'}], rows: [['1'], ['2'], ['3']]}),
      component('multiply', 'workflow', 'Multiply', 620, 170, {
        workflowId: INVOKER_CALLED_EXAMPLE_ID, sendEnvelope: true, onError: 'divert',
        parameters: [{name: 'times', value: '$n - 1', expression: true}],
      }),
      component('handling', 'workflow', 'Error handling', 1000, 380, {workflowId: INVOKER_ERROR_EXAMPLE_ID, sendEnvelope: true, parameters: []}),
      component(END, END, 'End', 1380, 200),
    ],
    edges: [
      connect(START, 'numbers'), connect('numbers', 'multiply'), connect('multiply', END),
      connect('multiply', 'handling', 'error'), connect('handling', END),
    ],
  };
  return [parent, multiply, handling];
}

/** Factory folder of each example. */
function exampleFolder(id: string) {
  if (id === SQL_SERVER_EXAMPLE_ID) return 'Data sources';
  if (id.startsWith(INVOKER_EXAMPLE_ID)) return 'Workflow Invoker';
  return 'Components';
}

/** Every example lives in the examples project. */
function exampleProject(_id: string) {
  return EXAMPLES_PROJECT;
}

const EXAMPLES = () => [
  exampleFlow(), filterExampleFlow(), routerExampleFlow(), lookupExampleFlow(), typescriptExampleFlow(), dataGridExampleFlow(), sqlServerExampleFlow(),
  ...invokerExampleFlows(),
];

/**
 * The flow without React Flow's screen state (selection, measured size, dragging, run marks): only the model is
 * stored and downloaded. Comments and groups keep width/height (their size is part of the model).
 */
export function cleanFlow(flow: Flow): Flow {
  return {
    ...flow,
    nodes: flow.nodes.map(n => without(n, NODE_SCREEN_STATE)),
    edges: flow.edges.map(e => without(e, EDGE_SCREEN_STATE)),
  };
}

// deletable: Start and End can't be deleted, the editor sets it when opening (it is not part of the model)
const NODE_SCREEN_STATE = ['selected', 'dragging', 'measured', 'resizing', 'positionAbsolute', 'className', 'deletable'];
const EDGE_SCREEN_STATE = ['selected', 'animated', 'className'];

function without<T extends object>(item: T, keys: string[]): T {
  return Object.fromEntries(Object.entries(item).filter(([key]) => !keys.includes(key))) as T;
}

/**
 * A flow as stored and downloaded: the defaults are left out (a node without `type` is a component, no `config` is an
 * empty one, no description/parameters/edges are empty, no folder is the root). fromDefinition puts them back.
 */
export type FlowDefinition = Omit<Flow, 'description' | 'parameters' | 'nodes' | 'edges'> & {
  description?: string;
  parameters?: WorkflowParameter[];
  nodes: Record<string, unknown>[];
  edges?: Edge[];
};

const isEmpty = (value: unknown) => value === '' || (Array.isArray(value) && value.length === 0)
  || (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0);

/** The flow without screen state nor defaults: what is stored and downloaded. */
export function toDefinition(flow: Flow): FlowDefinition {
  const {description, folder, parameters, nodes, edges, ...rest} = cleanFlow(flow);
  return {
    ...rest,
    ...(folder ? {folder} : {}),
    ...(description ? {description} : {}),
    ...(parameters?.length ? {parameters} : {}),
    nodes: nodes.map(node => {
      const {type, data, ...others} = node as FlowNode & {data: Record<string, unknown>};
      const lean = Object.fromEntries(Object.entries(data).filter(([key, value]) => !(key === 'config' && isEmpty(value))));
      return {...others, ...(type === 'component' ? {} : {type}), data: lean};
    }),
    ...(edges.length ? {edges} : {}),
  };
}

/** The other way: puts the defaults back (accepts old flows, which still have them). */
export function fromDefinition(definition: FlowDefinition): Flow {
  return {
    ...definition,
    description: definition.description ?? '',
    parameters: definition.parameters ?? [],
    nodes: definition.nodes.map(node => {
      const type = (node.type as string | undefined) ?? 'component';
      const data = (node.data ?? {}) as Record<string, unknown>;
      return without({...node, type, data: type === 'component' ? {config: {}, ...data} : data}, NODE_SCREEN_STATE) as FlowNode;
    }),
    edges: (definition.edges ?? []).map(e => without(e, EDGE_SCREEN_STATE)),
  };
}

export function listFlows(): Flow[] {
  let stored: Flow[] = [];
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) stored = (JSON.parse(saved) as FlowDefinition[]).map(fromDefinition);
  } catch {
    // storage unavailable or corrupted: starts empty
  }
  // the examples always go back to the original
  // an example can be moved to another folder (the saved folder applies; the rest goes back to the original)
  const examples = EXAMPLES().map(f => ({
    ...f, projectId: exampleProject(f.id), folder: stored.find(s => s.id === f.id)?.folder ?? exampleFolder(f.id),
  }));
  return [...examples, ...stored.filter(f => !examples.some(e => e.id === f.id))].map(f => ({...f, projectId: f.projectId ?? EXAMPLES_PROJECT}));
}

/** Moves the flow to another folder of the project. */
export function moveFlow(id: string, folder: string) {
  store(listFlows().map(f => (f.id === id ? {...f, folder} : f)));
}

/** Replaces the beginning of the folder path of the flows (folder renamed or moved). */
export function renameFlowsFolder(projectId: string, from: string, to: string) {
  store(listFlows().map(f => (f.projectId === projectId && isInside(f.folder ?? '', from) ? {...f, folder: to + (f.folder ?? '').slice(from.length)} : f)));
}

/** the folder is `base` or sits inside it */
export const isInside = (folder: string, base: string) => folder === base || folder.startsWith(base + '/');

/** Flows of a project. */
export function projectFlows(projectId: string): Flow[] {
  return listFlows().filter(f => f.projectId === projectId);
}

function store(flows: Flow[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(flows.map(toDefinition)));
  } catch {
    // no storage: the mock only lasts until reload
  }
}

export function getFlow(id: string): Flow | undefined {
  return listFlows().find(f => f.id === id);
}

export function saveFlow(flow: Flow): Flow {
  const flows = listFlows();
  const saved: Flow = {...flow, version: flow.version + 1, updatedAt: new Date().toISOString()};
  const exists = flows.some(f => f.id === flow.id);
  store(exists ? flows.map(f => f.id === flow.id ? saved : f) : [...flows, saved]);
  return saved;
}

export function deleteFlow(id: string) {
  store(listFlows().filter(f => f.id !== id));
}

export function duplicateFlow(id: string): Flow | undefined {
  const original = getFlow(id);
  if (!original) return undefined;
  const copy: Flow = {...structuredClone(original), id: 'f-' + Date.now().toString(36), name: `${original.name} (copy)`, status: 'draft', version: 0};
  return saveFlow(copy);
}
