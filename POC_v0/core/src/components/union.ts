import {Channel} from '../channel';
import type {ComponentLogic} from '#types/component-logic.type';
import type {Envelope} from '#types/envelope.type';

/**
 * Union: joins N paths into a single output, without touching DATA (in SnapLogic, Union).
 * Each envelope goes out as soon as it arrives, from any input.
 */

export const MIN_UNION_INPUTS = 2;
export const MAX_UNION_INPUTS = 100;

export function unionInputCount(config: Record<string, unknown>) {
  const n = Number(config.inputCount ?? MIN_UNION_INPUTS);
  return Math.min(MAX_UNION_INPUTS, Math.max(MIN_UNION_INPUTS, Number.isFinite(n) ? Math.round(n) : MIN_UNION_INPUTS));
}

export const union: ComponentLogic = {
  type: 'union',
  inputs: 1,
  outputs: 1,
  variableInputs: {min: MIN_UNION_INPUTS, max: MAX_UNION_INPUTS, key: 'inputCount'},

  validate() {
    return [];
  },

  async* execute(inputs, config, ctx) {
    const ports = Array.from({length: unionInputCount(config)}, (_, i) => `in-${i}`).filter(p => inputs[p]);
    let total = 0;

    // each input pours into a shared queue; the output reads the queue in arrival order
    const queue = new Channel<Envelope>();
    const pours = ports.map(async port => {
      for await (const doc of inputs[port]) await ctx.wait(queue.send(doc));
    });
    Promise.all(pours).finally(() => queue.close());
    for await (const doc of ctx.waitEach(queue)) {
      total += 1;
      yield {port: 'out-0', doc};
    }
    await Promise.all(pours);

    ctx.log('info', `${total} envelope(s) joined from ${ports.length} input(s).`);
  },
};
