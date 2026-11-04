import { z } from 'zod';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import { ConnectionRepository } from '../connection-store';
import { LIVE_TESTS, testProfile, type ConnectionTests, type TestConnectionResponse } from './test-profile';

export const TestConnectionCommand = z.object({ id: z.uuid('Invalid') });

export type { TestConnectionResponse };

/** "Test connection" of a saved profile (the list's menu) */
export class TestConnectionHandler implements UseCaseHandler<TestConnectionResponse> {
  constructor(private readonly tests: ConnectionTests = LIVE_TESTS) { }

  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<TestConnectionResponse>> {
    const parsed = validate(TestConnectionCommand, input);
    if (!parsed.ok) {
      return parsed;
    }

    const profile = await new ConnectionRepository(ctx.db, ctx.orgId).findById(parsed.value.id);
    if (!profile) {
      return fail('not-found', 'Connection not found.');
    }

    return testProfile(ctx, this.tests, profile.projectId, profile);
  }
}
