import type {Envelope} from '#types/envelope.type';
import type {ErrorPolicy} from '#types/error-policy.type';
import type {ExecutableNode} from '#types/executable-node.type';

/**
 * Envelope that goes out through the error port: gets DATA.errors.
 * It is a list: if the same envelope fails in more than one component, the errors accumulate.
 */
export function withError(doc: Envelope, error: Error, component: string): Envelope {
  const previous = Array.isArray(doc.DATA.errors) ? doc.DATA.errors : [];
  return {...doc, DATA: {...doc.DATA, errors: [...previous, {error: error.name || 'Error', message: error.message, component}]}};
}

/** The node's "On error" policy (Stop by default). */
export function errorPolicy(node: ExecutableNode): ErrorPolicy {
  const v = node.config.onError;
  return v === 'continue' || v === 'divert' ? v : 'stop';
}
