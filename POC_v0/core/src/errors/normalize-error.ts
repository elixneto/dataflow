/**
 * Normalizes anything thrown into an Error, keeping its type (name). Errors from node:vm come from another
 * "realm" and fail `instanceof Error`, so the check is by shape.
 */
export function toError(e: unknown): Error {
  if (e instanceof Error) return e;
  if (e && typeof e === 'object' && 'message' in e) {
    const error = new Error(String((e as {message: unknown}).message));
    error.name = 'name' in e ? String((e as {name: unknown}).name) : 'Error';
    return error;
  }
  return new Error(String(e));
}
