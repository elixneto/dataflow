import type {Envelope} from '#types/envelope.type';

/** What execute yields: an envelope on a port, or an error tied to the envelope that failed. */
export type ComponentOutput =
  | {port: string; doc: Envelope}
  | {error: Error; doc: Envelope};
