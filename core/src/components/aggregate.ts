import {nameIssue} from '../envelope'
import type {ComponentLogic, Envelope} from '../types'

/**
 * Aggregate: groups envelopes into batches of N and yields one envelope per batch, with the list of DATA in a field
 * (default `items`): {items: [DATA, DATA, ...]}. The last batch may be smaller. Useful to send many records
 * at once to an API or a database (e.g. Aggregate of 500 → TypeScript that makes one call per batch).
 */

export const MAX_BATCH_SIZE = 10_000

export function aggregateConfig(config: Record<string, unknown>) {
  const n = Math.round(Number(config.size ?? 500))
  return {
    size: Number.isFinite(n) ? Math.min(MAX_BATCH_SIZE, Math.max(1, n)) : 500,
    field: typeof config.field === 'string' ? config.field : 'items',
  }
}

export const aggregate: ComponentLogic = {
  type: 'aggregate',
  inputs: ['envelope'],
  outputs: ['envelope'],

  validate(config) {
    const issue = nameIssue(aggregateConfig(config).field)
    return issue ? [`field ${issue}.`] : []
  },

  async* execute(inputs, config, ctx) {
    const {size, field} = aggregateConfig(config)
    let batch: Envelope[] = []
    let batches = 0
    let received = 0
    const flush = () => {
      batches += 1
      const doc: Envelope = {WORKFLOW_CURRENT_RUN: batch[0].WORKFLOW_CURRENT_RUN, PARAMETERS: batch[0].PARAMETERS, DATA: {[field]: batch.map(d => d.DATA)}}
      batch = []
      ctx.holding(0)
      return {port: 'out-0', doc}
    }
    for await (const doc of inputs['in-0'] ?? []) {
      received += 1
      batch.push(doc)
      ctx.holding(batch.length, doc)
      if (batch.length >= size) yield flush()
    }
    if (batch.length) yield flush()
    ctx.log('info', `${received} envelope(s) in ${batches} batch(es) of up to ${size}.`)
  },
}
