import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { UseCaseErrorCode, UseCaseResult } from './use-case-result';

const STATUS: Record<UseCaseErrorCode, ContentfulStatusCode> = {
  validation: 400,
  forbidden: 403,
  'not-found': 404,
  conflict: 409,
  unavailable: 502,
};

/**
 * Answers a use case result over HTTP (like ToHttpResult() in GRO): the value with `successStatus` (200, or 201 for
 * a create), or {error: {code, message, fields?}} with the status of the error code.
 */
export function toHttpResult<T>(c: Context, result: UseCaseResult<T>, successStatus: ContentfulStatusCode = 200) {
  if (result.ok) {
    return c.json(result.value ?? null, successStatus);
  }

  return c.json({ error: result.error }, STATUS[result.error.code]);
}
