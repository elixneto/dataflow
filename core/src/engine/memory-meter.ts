import {INITIAL_MEASURES, MEASURE_INTERVAL} from '#engine/constants';
import type {ComponentRun} from '#types/component-run.type';
import type {Envelope} from '#types/envelope.type';

/** Peak of what the component held (ctx.holding). Bytes = peak × average size of the DATA JSON (sampled). */
export class MemoryMeter {
  peak = 0;
  private calls = 0;
  private measured = 0;
  private measuredBytes = 0;

  holding(envelopes: number, held?: Envelope) {
    this.peak = Math.max(this.peak, envelopes);
    if (!held) return;
    this.calls += 1;
    if (this.measured >= INITIAL_MEASURES && this.calls % MEASURE_INTERVAL !== 0) return;
    try {
      this.measuredBytes += JSON.stringify(held.DATA)?.length ?? 0;
      this.measured += 1;
    } catch { /* DATA that cannot become JSON (e.g. BigInt): left unmeasured */ }
  }

  get summary(): ComponentRun['memory'] {
    if (this.peak === 0) return undefined;
    const average = this.measured ? this.measuredBytes / this.measured : 0;
    return {peakEnvelopes: this.peak, peakBytes: Math.round(this.peak * average)};
  }
}
