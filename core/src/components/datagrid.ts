import {mergeFields, nameIssue} from '../envelope'
import type {ComponentLogic, ParameterType} from '../types'

/**
 * Data Grid (in Kettle, Data grid): a table typed into the component itself. For each incoming envelope (usually the
 * only one the Start yields), yields one envelope per row, with the columns written into DATA (like the Mapper).
 * Useful for mappings (connected to the Lookup's lookup input) and to test a flow without input.
 * Cells are stored as text in the config and converted by the column type; an empty cell becomes null.
 */

export type DataGridColumn = {name: string; type: ParameterType}

export function dataGridConfig(config: Record<string, unknown>) {
  const columns = Array.isArray(config.columns) ? (config.columns as DataGridColumn[]) : []
  const rows = Array.isArray(config.rows) ? (config.rows as string[][]) : []
  return {columns, rows}
}

const TRUE_VALUES = ['true', 'yes', 'y', '1']
const FALSE_VALUES = ['false', 'no', 'n', '0']

/** Cell value in the column type; text that does not convert returns undefined (becomes a validation issue). */
export function cellValue(text: string | undefined, type: ParameterType): unknown {
  const t = (text ?? '').trim()
  if (t === '') return null
  if (type === 'number') {
    // accepts a decimal comma (pasted from a spreadsheet in a comma locale); thousands separators are not accepted
    const n = Number(t.replace(',', '.'))
    return Number.isFinite(n) ? n : undefined
  }
  if (type === 'boolean') {
    const v = t.toLowerCase()
    return TRUE_VALUES.includes(v) ? true : FALSE_VALUES.includes(v) ? false : undefined
  }
  return text
}

export const datagrid: ComponentLogic = {
  type: 'datagrid',
  inputs: ['envelope'],
  outputs: ['envelope'],

  validate(config) {
    const {columns, rows} = dataGridConfig(config)
    if (columns.length === 0) return ['has no columns.']
    const issues: string[] = []
    const seen = new Set<string>()
    columns.forEach((c, i) => {
      const issue = nameIssue(c.name)
      if (issue) issues.push(`column ${i + 1} ${issue}.`)
      else if (seen.has(c.name)) issues.push(`has the column "${c.name}" more than once.`)
      seen.add(c.name)
    })
    if (rows.length === 0) issues.push('has no rows.')
    rows.forEach((row, i) => columns.forEach((c, j) => {
      if (cellValue(row[j], c.type) !== undefined) return
      issues.push(`row ${i + 1}, column "${c.name || j + 1}": "${row[j]}" is not a ${c.type === 'number' ? 'number' : 'boolean'}.`)
    }))
    return issues
  },

  async* execute(inputs, config, ctx) {
    const {columns, rows} = dataGridConfig(config)
    const records = rows.map(row => Object.fromEntries(columns.map((c, j) => [c.name, cellValue(row[j], c.type) ?? null])))
    let received = 0
    for await (const doc of inputs['in-0'] ?? []) {
      received += 1
      for (const record of records) yield {port: 'out-0', doc: mergeFields(doc, record, ctx.node.override)}
    }
    ctx.log('info', `${records.length} row(s) yielded for ${received} input envelope(s).`)
  },
}
