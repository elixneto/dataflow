import type {ComponentLogic} from '#types/component-logic.type';
import type {Envelope} from '#types/envelope.type';

/**
 * Limit: lets only N envelopes through. Top: the first N, as they arrive (the rest of the input is read and dropped, so
 * the components before it are not left waiting). Bottom: the last N, only when the input ends (it holds the last N
 * that arrived). Does not touch DATA. Handy to test a flow on a sample.
 */

export type LimitMode = 'top' | 'bottom';

export const MAX_LIMIT = 1_000_000;

export function limitConfig(config: Record<string, unknown>) {
  const n = Math.round(Number(config.count ?? 10));
  return {
    mode: (config.mode === 'bottom' ? 'bottom' : 'top') as LimitMode,
    count: Number.isFinite(n) ? Math.min(MAX_LIMIT, Math.max(1, n)) : 10,
  };
}

export const limit: ComponentLogic = {
  type: 'limit',
  inputs: 1,
  outputs: 1,

  validate() {
    return [];
  },

  async* execute(inputs, config, ctx) {
    const {mode, count} = limitConfig(config);
    let received = 0;
    if (mode === 'top') {
      for await (const doc of inputs['in-0'] ?? []) {
        received += 1;
        if (received <= count) yield {port: 'out-0', doc};
      }
    } else {
      // ring buffer with the last N: the oldest one is overwritten
      const last: Envelope[] = [];
      for await (const doc of inputs['in-0'] ?? []) {
        last[received % count] = doc;
        received += 1;
        ctx.holding(Math.min(received, count), doc);
      }
      const kept = Math.min(received, count);
      for (let i = 0; i < kept; i++) {
        ctx.holding(kept - i - 1);
        yield {port: 'out-0', doc: last[(received - kept + i) % count]};
      }
    }
    const passed = Math.min(received, count);
    ctx.log('info', `${passed} of ${received} envelope(s) passed (${mode} ${count}).`);
  },
};
