import type {EnvelopeData} from '#types/envelope-data.type';

/** Flow node as the runner receives it (no position or anything visual). */
export type ExecutableNode = {
  id: string;
  type: string;
  label: string;
  config: Record<string, unknown>;
  /** name of the key the component adds to DATA */
  outputKey?: string;
  /** the output carries only this component's key (drops the rest of DATA) */
  override?: boolean;
  disabled?: boolean;
  /**
   * Pinned output (like n8n's pin data): the DATA of each envelope per output port. Only in test runs (`validation`):
   * the node does not execute, its input is read and dropped, and these envelopes go out instead; what only feeds it is
   * skipped. A real run (`execution`) ignores it.
   */
  pinned?: Record<string, EnvelopeData[]>;

};
