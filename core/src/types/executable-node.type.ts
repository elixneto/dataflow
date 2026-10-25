import type {EnvelopeData} from '#types/envelope-data.type';

/** Workflow node as the runner receives it (no position or anything visual). */
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
   * Pinned output (like n8n's pin data): the DATA of each envelope per output port. The node does not execute, its
   * input is read and dropped, and these envelopes go out instead; whatever only feeds pinned nodes does not run.
   */
  pinned?: Record<string, EnvelopeData[]>;
};
