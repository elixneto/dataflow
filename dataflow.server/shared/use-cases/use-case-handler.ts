import type { UseCaseContext } from './use-case-context';
import type { UseCaseResult } from './use-case-result';

/**
 * A command or query of a feature. `input` is unknown on purpose: the handler validates
 * it (see validate.ts), so the api passes the request body as it came.
 */
export interface UseCaseHandler<T = void> {
  handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<T>>;
}
