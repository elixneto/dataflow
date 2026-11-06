import {
  aggregate,
  datagrid,
  distinct,
  filter,
  httpRequest,
  limit,
  log,
  lookup,
  mapper,
  mongodbDelete,
  mongodbPipeline,
  mongodbUpsert,
  router,
  sort,
  split,
  sqlserver,
  typescript,
  scriptInvoker,
  flowInvoker,
  discard,
  END,
  START,
} from '@dataflow/core';
import {
  ArrowDownUp,
  Database,
  FileCode,
  FingerprintPattern,
  Funnel,
  Globe,
  Layers,
  Leaf,
  ListEnd,
  ScrollText,
  SearchCheck,
  Shuffle,
  Split,
  SquareFunction,
  Table,
  Trash2,
  Ungroup,
  Workflow,
  Flag,
  Play,
  type LucideIcon,
} from 'lucide-react';

/*
 * The components the editor offers, as in the PoC: the logic (validate, run) is @dataflow/core's, here only how each one
 * looks (label, description, category, icon). Grouped by the system a component talks to.
 */

export type Category = 'database' | 'api' | 'code' | 'transformation' | 'flow';

/** order of the categories in the palette; within each one, by label */
export const CATEGORY_ORDER: Category[] = ['database', 'api', 'code', 'transformation', 'flow'];

/** label and color (a CSS variable from index.css, light and dark) of each category */
export const CATEGORIES: Record<Category, { label: string; color: string }> = {
  database: { label: 'Databases', color: 'var(--category-database)' },
  api: { label: 'APIs', color: 'var(--category-api)' },
  code: { label: 'Scripting', color: 'var(--category-code)' },
  transformation: { label: 'Transformation', color: 'var(--category-transformation)' },
  flow: { label: 'Flow', color: 'var(--category-flow)' },
};

export type ComponentInfo = {
  /** the core component's type */
  type: string;
  label: string;
  description: string;
  category: Category;
  icon: LucideIcon;
};

const COMPONENTS: ComponentInfo[] = [
  { type: sqlserver.type, label: 'SQL Server Query', description: 'Reads rows from SQL Server (read only)', category: 'database', icon: Database },
  { type: mongodbPipeline.type, label: 'MongoDB Pipeline', description: 'Reads documents with an aggregation pipeline', category: 'database', icon: Leaf },
  { type: mongodbUpsert.type, label: 'MongoDB Upsert', description: 'Writes each envelope into a collection', category: 'database', icon: Leaf },
  { type: mongodbDelete.type, label: 'MongoDB Delete', description: 'Deletes the documents that match a filter', category: 'database', icon: Leaf },
  { type: httpRequest.type, label: 'HTTP Request', description: 'Sends one HTTP request per envelope', category: 'api', icon: Globe },
  { type: typescript.type, label: 'TypeScript', description: 'Processes the envelopes with code', category: 'code', icon: FileCode },
  { type: scriptInvoker.type, label: 'Script Invoker', description: 'Calls a function a project script exports', category: 'code', icon: SquareFunction },
  { type: aggregate.type, label: 'Aggregate', description: 'Groups the envelopes into batches', category: 'transformation', icon: Layers },
  { type: datagrid.type, label: 'Data Grid', description: 'A typed table that emits one envelope per row', category: 'transformation', icon: Table },
  { type: distinct.type, label: 'Distinct', description: 'Lets through only the first envelope of each key', category: 'transformation', icon: FingerprintPattern },
  { type: filter.type, label: 'Filter', description: 'Splits the envelopes into true and false', category: 'transformation', icon: Funnel },
  { type: limit.type, label: 'Limit', description: 'Lets only the first or last N envelopes through', category: 'transformation', icon: ListEnd },
  { type: lookup.type, label: 'Lookup', description: 'Finds the envelope of another input by key', category: 'transformation', icon: SearchCheck },
  { type: mapper.type, label: 'Mapper', description: 'Writes fields into the envelope (source → target)', category: 'transformation', icon: Shuffle },
  { type: router.type, label: 'Router', description: 'Sends each envelope to the first true case', category: 'transformation', icon: Split },
  { type: sort.type, label: 'Sort', description: 'Sorts the envelopes by keys', category: 'transformation', icon: ArrowDownUp },
  { type: split.type, label: 'Split', description: 'Yields one envelope per item of a list', category: 'transformation', icon: Ungroup },
  { type: log.type, label: 'Log', description: 'Records a message for each envelope', category: 'flow', icon: ScrollText },
  { type: discard.type, label: 'Discard', description: 'Drops every envelope that reaches it (no output)', category: 'flow', icon: Trash2 },
  { type: flowInvoker.type, label: 'Flow Invoker', description: 'Calls another flow with the parameters of its Start', category: 'flow', icon: Workflow },
];

/** the component of a type (undefined for one the editor does not know) */
/**
 * Start and End, as in the PoC: every flow has one of each, they cannot be deleted and are not in the palette. The
 * Start's output and the End's input take several edges (the flow begins and finishes in several places).
 */
const FIXED: ComponentInfo[] = [
  { type: START, label: 'Start', description: 'Starting point of the flow', category: 'flow', icon: Play },
  { type: END, label: 'End', description: 'Every chain ends here', category: 'flow', icon: Flag },
];

export const isFixedType = (type: string) => type === START || type === END;

export const componentInfo = (type: string): ComponentInfo | undefined => [...COMPONENTS, ...FIXED].find(c => c.type === type);

/** the palette's sections: each category (in CATEGORY_ORDER) with its components by label; `search` filters by label or description */
export function paletteSections(search = ''): { category: Category; components: ComponentInfo[] }[] {
  const term = search.trim().toLowerCase();
  const matches = (c: ComponentInfo) => !term || c.label.toLowerCase().includes(term) || c.description.toLowerCase().includes(term);

  return CATEGORY_ORDER.map(category => ({
    category,
    components: COMPONENTS.filter(c => c.category === category && matches(c)).sort((a, b) => a.label.localeCompare(b.label, 'en')),
  })).filter(section => section.components.length > 0);
}
