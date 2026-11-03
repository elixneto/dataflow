import type {Envelope} from '#types/envelope.type';
import type {EnvelopeData} from '#types/envelope-data.type';

/** New envelope with the component's key in DATA (Override: only that key). */
export function withKey(doc: Envelope, key: string, value: unknown, override = false): Envelope {
  return {
    WORKFLOW_CURRENT_RUN: doc.WORKFLOW_CURRENT_RUN,
    PARAMETERS: doc.PARAMETERS,
    DATA: override ? {[key]: value} : {...doc.DATA, [key]: value},
  };
}

/** New envelope with the fields written directly into DATA (adds or replaces). Override: only these fields. */
export function mergeFields(doc: Envelope, fields: EnvelopeData, override = false): Envelope {
  return {
    WORKFLOW_CURRENT_RUN: doc.WORKFLOW_CURRENT_RUN,
    PARAMETERS: doc.PARAMETERS,
    DATA: override ? {...fields} : {...doc.DATA, ...fields},
  };
}
