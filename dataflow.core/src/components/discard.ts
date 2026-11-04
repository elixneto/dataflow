import type {ComponentLogic} from '#types/component-logic.type';

/**
 * Discard: the end of a path that leads nowhere on purpose. It takes every envelope that reaches it and drops it: no
 * output, nothing written anywhere. Its log says how many. A run whose envelopes all went to a Discard does not warn
 * that nothing reached the End (they were dropped on purpose).
 */
export const discard: ComponentLogic = {
  type: 'discard',
  inputs: 1,
  outputs: 0,
  settings: [],

  validate() {
    return [];
  },

  async* execute(inputs, _config, ctx) {
    let dropped = 0;
    for await (const doc of inputs['in-0'] ?? []) {
      void doc;
      dropped += 1;
    }
    ctx.log('info', `${dropped} envelope(s) discarded.`);
  },
};
