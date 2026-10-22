import {toError} from '../envelope'
import type {ComponentLogic} from '../types'

/**
 * Router (in Kettle, Switch / case): N cases, each with an expression condition and its own output (out-0, out-1...),
 * plus the else output (the last one), for the envelope where no case was true. The first true case wins,
 * in list order. Does not touch DATA. The else may stay unconnected (drops).
 */

export type RouterCase = {label: string; condition: string}

export function routerCases(config: Record<string, unknown>): RouterCase[] {
  return Array.isArray(config.cases) ? (config.cases as RouterCase[]) : []
}

/** Port of the else output: after the cases' ports. */
export function routerElsePort(config: Record<string, unknown>) {
  return `out-${routerCases(config).length}`
}

export const router: ComponentLogic = {
  type: 'router',
  inputs: ['envelope'],
  // one per case + the else; the count comes from the configuration
  outputs: ['envelope'],
  optionalOutputs: config => [routerElsePort(config)],

  validate(config) {
    const cases = routerCases(config)
    if (cases.length === 0) return ['has no cases.']
    const issues: string[] = []
    cases.forEach((c, i) => {
      if (!c.condition?.trim()) issues.push(`case ${i + 1} has no condition.`)
    })
    return issues
  },

  async* execute(inputs, config, ctx) {
    const cases = routerCases(config)
    const perCase = cases.map(() => 0)
    let inElse = 0
    for await (const doc of inputs['in-0'] ?? []) {
      try {
        const i = cases.findIndex(c => ctx.fieldValue({value: c.condition, expression: true}, doc))
        if (i >= 0) perCase[i] += 1
        else inElse += 1
        yield {port: `out-${i >= 0 ? i : cases.length}`, doc}
      } catch (e) {
        yield {error: toError(e), doc}
      }
    }
    ctx.log('info', [...cases.map((c, i) => `${c.label || `case ${i + 1}`}: ${perCase[i]}`), `else: ${inElse}`].join(', ') + '.')
  },
}
