import type {Envelope} from '#types/envelope.type';
import type {ErrorPolicy} from '#types/error-policy.type';
import type {ExecutableNode} from '#types/executable-node.type';
import {onErrorOf} from '#validation/ports';

/**
 * Envelope that goes out through the error port: gets DATA.errors.
 * It is a list: if the same envelope fails in more than one component, the errors accumulate.
 */
export function withError(doc: Envelope, error: Error, component: string): Envelope {
  const previous = Array.isArray(doc.DATA.errors) ? doc.DATA.errors : [];
  return {...doc, DATA: {...doc.DATA, errors: [...previous, {error: error.name || 'Error', message: error.message, component}]}};
}

/**
 * The node's "On error" policy (Throw by default: stops the run); a fixed one when its config leaves no choice (a fire
 * and forget Flow Invoker). Divert goes out through ERROR_PORT (validation/ports.ts).
 */
export function errorPolicy(node: ExecutableNode): ErrorPolicy {
  return onErrorOf(node.type, node.config);
}
