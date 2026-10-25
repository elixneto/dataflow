import {Flag, Play} from 'lucide-react';
import {FILTER} from '#components/filter';
import {LIMIT} from '#components/limit';
import {LOG} from '#components/log';
import {LOOKUP} from '#components/lookup';
import {AGGREGATE} from '#components/aggregate';
import {COPY} from '#components/copy';
import {DATA_GRID} from '#components/datagrid';
import {DISTINCT} from '#components/distinct';
import {MAPPER} from '#components/mapper';
import {TYPESCRIPT} from '#components/typescript';
import {ROUTER} from '#components/router';
import {SORT} from '#components/sort';
import {SPLIT} from '#components/split';
import {SQL_SERVER} from '#components/sqlserver';
import {MONGODB_PIPELINE} from '#components/mongodb-pipeline';
import {MONGODB_UPSERT} from '#components/mongodb-upsert';
import {UNION} from '#components/union';
import {WORKFLOW_INVOKER} from '#components/workflow';
import type {Category} from '#types/category.type';
import type {ComponentDef} from '#types/component-def.type';

export const CATEGORIES: Record<Category, {label: string; textColor: string; bgColor: string; borderColor: string}> = {
  source: {label: 'Data Sources', textColor: 'text-file', bgColor: 'bg-file/15', borderColor: 'border-file'},
  transformation: {label: 'Transformation', textColor: 'text-transform', bgColor: 'bg-transform/15', borderColor: 'border-transform'},
  code: {label: 'Scripting', textColor: 'text-code', bgColor: 'bg-code/15', borderColor: 'border-code'},
  entity: {label: 'Destinations', textColor: 'text-entity', bgColor: 'bg-entity/15', borderColor: 'border-entity'},
  flow: {label: 'Flow', textColor: 'text-flow', bgColor: 'bg-flow/15', borderColor: 'border-flow'},
};

/** Order of the categories wherever they are listed (the palette, its search): within each one, by component label. */
export const CATEGORY_ORDER: Category[] = ['source', 'entity', 'code', 'transformation', 'flow'];

/** CSS variable with the category color (the theme variables still use the v0 names). */
export const CATEGORY_COLOR: Record<Category, string> = {
  source: 'var(--file)',
  transformation: 'var(--transform)',
  code: 'var(--code)',
  entity: 'var(--entity)',
  flow: 'var(--flow)',
};

export const START = 'start';
export const END = 'end';

const FLOW: ComponentDef[] = [
  {type: START, label: 'Start', description: 'Starting point of the flow', category: 'flow', icon: Play, inputs: 0, outputs: 1},
  {type: END, label: 'End', description: 'Every chain ends here', category: 'flow', icon: Flag, inputs: 1, outputs: 0},
];

/**
 * Components shown in the palette, ordered by category (CATEGORY_ORDER) and then by label. Each new component is designed
 * (inputs, outputs, card, panel, validation) and added here.
 */
export const PALETTE: ComponentDef[] = [MAPPER, DATA_GRID, FILTER, ROUTER, LOOKUP, UNION, COPY, AGGREGATE, SPLIT, DISTINCT, SORT, LIMIT, TYPESCRIPT, SQL_SERVER, MONGODB_PIPELINE, MONGODB_UPSERT, WORKFLOW_INVOKER, LOG]
  .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.label.localeCompare(b.label, 'en'));

export const BY_TYPE: Record<string, ComponentDef> = Object.fromEntries([...PALETTE, ...FLOW].map(c => [c.type, c]));

export function isFlowNode(type: string) {
  return type === START || type === END;
}

export const DRAG_MIME = 'application/x-dataflow-component';
