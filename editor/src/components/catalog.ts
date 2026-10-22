import {Flag, Play} from 'lucide-react'
import {FILTER} from './filter'
import {LOOKUP} from './lookup'
import {AGGREGATE} from './aggregate'
import {COPY} from './copy'
import {DATA_GRID} from './datagrid'
import {MAPPER} from './mapper'
import {TYPESCRIPT} from './typescript'
import {ROUTER} from './router'
import {SQL_SERVER} from './sqlserver'
import {UNION} from './union'
import {WORKFLOW_INVOKER} from './workflow'
import type {Category, ComponentDef} from './types'

export const CATEGORIES: Record<Category, {label: string; textColor: string; bgColor: string; borderColor: string}> = {
  source: {label: 'Data Sources', textColor: 'text-file', bgColor: 'bg-file/15', borderColor: 'border-file'},
  transformation: {label: 'Transformation', textColor: 'text-transform', bgColor: 'bg-transform/15', borderColor: 'border-transform'},
  code: {label: 'Scripting', textColor: 'text-code', bgColor: 'bg-code/15', borderColor: 'border-code'},
  entity: {label: 'Destinations', textColor: 'text-entity', bgColor: 'bg-entity/15', borderColor: 'border-entity'},
  flow: {label: 'Flow', textColor: 'text-flow', bgColor: 'bg-flow/15', borderColor: 'border-flow'},
}

/** CSS variable with the category color (the theme variables still use the v0 names). */
export const CATEGORY_COLOR: Record<Category, string> = {
  source: 'var(--file)',
  transformation: 'var(--transform)',
  code: 'var(--code)',
  entity: 'var(--entity)',
  flow: 'var(--flow)',
}

export const START = 'start'
export const END = 'end'

const FLOW: ComponentDef[] = [
  {type: START, label: 'Start', description: 'Starting point of the flow', category: 'flow', icon: Play, inputs: [], outputs: ['envelope']},
  {type: END, label: 'End', description: 'Every chain ends here', category: 'flow', icon: Flag, inputs: ['any'], outputs: []},
]

/**
 * Components shown in the palette, in alphabetical order within each section. Each new component is designed
 * (inputs, outputs, card, panel, validation) and added here.
 */
export const PALETTE: ComponentDef[] = [MAPPER, DATA_GRID, FILTER, ROUTER, LOOKUP, UNION, COPY, AGGREGATE, TYPESCRIPT, SQL_SERVER, WORKFLOW_INVOKER]
  .sort((a, b) => a.label.localeCompare(b.label, 'en'))

export const BY_TYPE: Record<string, ComponentDef> = Object.fromEntries([...PALETTE, ...FLOW].map(c => [c.type, c]))

export function isFlowNode(type: string) {
  return type === START || type === END
}

export const DRAG_MIME = 'application/x-dataflow-component'
