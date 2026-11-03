import type {ComponentLogic} from '#types/component-logic.type';

/**
 * Copy: the opposite of Union. Sends each incoming envelope to all outputs (2 to 10), so the same data follows
 * different paths (in SnapLogic, Copy; in Kettle, "copy rows to next steps").
 * Each output gets its own copy of the envelope, so one path does not touch what the other receives (e.g. a script that
 * changes $input). The pace is that of the slowest path: the envelope only moves on when every output has accepted it.
 */

export const MIN_COPY_OUTPUTS = 2;
export const MAX_COPY_OUTPUTS = 10;

export function copyOutputCount(config: Record<string, unknown>) {
  const n = Number(config.outputCount ?? MIN_COPY_OUTPUTS);
  return Math.min(MAX_COPY_OUTPUTS, Math.max(MIN_COPY_OUTPUTS, Number.isFinite(n) ? Math.round(n) : MIN_COPY_OUTPUTS));
}

export const copy: ComponentLogic = {
  type: 'copy',
  inputs: 1,
  outputs: 1,
  variableOutputs: {min: MIN_COPY_OUTPUTS, max: MAX_COPY_OUTPUTS, key: 'outputCount'},

  validate() {
    return [];
  },

  async* execute(inputs, config, ctx) {
    const count = copyOutputCount(config);
    let received = 0;
    for await (const doc of inputs['in-0'] ?? []) {
      received += 1;
      // copy before yielding: the first output may start changing the envelope while the others wait
      const copies = Array.from({length: count - 1}, () => structuredClone(doc));
      yield {port: 'out-0', doc};
      for (let i = 1; i < count; i++) yield {port: `out-${i}`, doc: copies[i - 1]};
    }
    ctx.log('info', `${received} envelope(s) copied to ${count} outputs.`);
  },
};
