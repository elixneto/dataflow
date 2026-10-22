import {withKey, toError} from '../envelope'
import type {ComponentLogic} from '../types'

/**
 * TypeScript: the user writes `async function process($input)` (and as many helper functions as they want).
 * $input is the envelope's DATA (to process many at once, put an Aggregate before it).
 * Without Override, the return value (any value) goes to the node's output key ($result) and the envelope moves on with the rest.
 * With Override, the return value becomes the whole DATA: object = 1 envelope, list = 1 per item, null/undefined = none.
 * An exception is an error of the envelope (follows the "On error" policy). Globals: $PARAMETERS, $SECRETS,
 * $WORKFLOW_CURRENT_RUN and log().
 */

export const DEFAULT_CODE = `async function process($input: Data) {
  return null
}
`

export function typescriptConfig(config: Record<string, unknown>) {
  return {code: typeof config.code === 'string' ? config.code : DEFAULT_CODE}
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export const typescript: ComponentLogic = {
  type: 'typescript',
  inputs: ['envelope'],
  outputs: ['envelope'],
  defaultOutputKey: 'result',

  validate(config) {
    const {code} = typescriptConfig(config)
    return /\bfunction\s+process\s*\(/.test(code) ? [] : ['has no process function.']
  },

  async* execute(inputs, config, ctx) {
    const {code} = typescriptConfig(config)
    const process = await ctx.prepareScript(code)
    let received = 0
    let sent = 0
    for await (const doc of inputs['in-0'] ?? []) {
      received += 1
      try {
        const returned = await process(doc.DATA)
        if (!ctx.node.override) {
          sent += 1
          yield {port: 'out-0', doc: withKey(doc, ctx.node.outputKey || 'result', returned ?? null)}
          continue
        }
        if (returned === null || returned === undefined) continue
        const items = Array.isArray(returned) ? returned : [returned]
        if (!items.every(isObject)) throw new TypeError('With Override, process must return an object, a list of objects or null.')
        for (const DATA of items) {
          sent += 1
          yield {port: 'out-0', doc: {WORKFLOW_CURRENT_RUN: doc.WORKFLOW_CURRENT_RUN, PARAMETERS: doc.PARAMETERS, DATA}}
        }
      } catch (e) {
        yield {error: toError(e), doc}
      }
    }
    ctx.log('info', `${received} envelope(s) in and ${sent} out.`)
  },
}
