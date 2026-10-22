import {toError, mergeFields, nameIssue} from '../envelope'
import type {ExpressionField, ComponentLogic} from '../types'

/**
 * Mapper: writes fields directly into DATA (source → target), adding or replacing the value.
 * E.g.: "PINEAPPLE" → field; then another Mapper does $field + " 123" → otherField
 *      and DATA becomes {field: "PINEAPPLE", otherField: "PINEAPPLE 123"}.
 * Sources are evaluated on the incoming envelope (the line above does not see what the line below writes).
 * Override: the output DATA carries only the mapped fields.
 */

export type MapperField = ExpressionField & {target: string}

export function mapperFields(config: Record<string, unknown>): MapperField[] {
  return Array.isArray(config.fields) ? (config.fields as MapperField[]) : []
}

export const mapper: ComponentLogic = {
  type: 'mapper',
  inputs: ['envelope'],
  outputs: ['envelope'],

  validate(config) {
    const fields = mapperFields(config)
    if (fields.length === 0) return ['has no fields.']
    const issues: string[] = []
    const seen = new Set<string>()
    fields.forEach((f, i) => {
      const issue = nameIssue(f.target)
      if (issue) issues.push(`field ${i + 1} ${issue}.`)
      else if (seen.has(f.target)) issues.push(`has the field "${f.target}" more than once.`)
      seen.add(f.target)
      if (f.expression && !f.value.trim()) issues.push(`field "${f.target || i + 1}" is an expression, but empty.`)
    })
    return issues
  },

  async* execute(inputs, config, ctx) {
    const fields = mapperFields(config)
    let mapped = 0
    for await (const doc of inputs['in-0'] ?? []) {
      try {
        const output: Record<string, unknown> = {}
        for (const field of fields) output[field.target] = ctx.fieldValue(field, doc)
        mapped += 1
        yield {port: 'out-0', doc: mergeFields(doc, output, ctx.node.override)}
      } catch (e) {
        yield {error: toError(e), doc}
      }
    }
    ctx.log('info', `${mapped} envelope(s) mapped: ${fields.map(f => f.target).join(', ')}.`)
  },
}
