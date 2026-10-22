import {toError} from '../envelope'
import type {ComponentLogic} from '../types'

/**
 * Filter (in Kettle, Filter rows): evaluates an expression condition for each envelope and sends the envelope,
 * without touching DATA, to the true output (out-0) or the false one (out-1). The false one may stay unconnected (drops). JS rules apply: `0`, `""`, `null` etc. are false.
 */

export function filterCondition(config: Record<string, unknown>): string {
  return typeof config.condition === 'string' ? config.condition : ''
}

export const filter: ComponentLogic = {
  type: 'filter',
  inputs: ['envelope'],
  outputs: ['envelope', 'envelope'],
  optionalOutputs: ['out-1'],

  validate(config) {
    return filterCondition(config).trim() ? [] : ['has no condition.']
  },

  async* execute(inputs, config, ctx) {
    const condition = filterCondition(config)
    let trues = 0
    let falses = 0
    for await (const doc of inputs['in-0'] ?? []) {
      try {
        if (ctx.fieldValue({value: condition, expression: true}, doc)) {
          trues += 1
          yield {port: 'out-0', doc}
        } else {
          falses += 1
          yield {port: 'out-1', doc}
        }
      } catch (e) {
        yield {error: toError(e), doc}
      }
    }
    ctx.log('info', `${trues} envelope(s) to true and ${falses} to false.`)
  },
}
