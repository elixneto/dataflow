import { z } from 'zod';
import { ProjectRepository } from '#features/projects/project-repository';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import { LIVE_TESTS, testProfile, type ConnectionTests, type TestConnectionResponse } from '../test-connection/test-profile';

export const TestConnectionDraftCommand = z.object({
  projectId: z.uuid('Invalid'),
  type: z.string(),
  config: z.record(z.string(), z.string()),
  newSecrets: z.array(z.object({ name: z.string().trim(), value: z.string() })).default([]),
});

/**
 * "Test connection" from the form, while creating or editing: the profile as typed, nothing saved. The secrets typed
 * with "+ New" are used for this test only.
 */
export class TestConnectionDraftHandler implements UseCaseHandler<TestConnectionResponse> {
  /** `tests` replaces the drivers in tests */
  constructor(private readonly tests: ConnectionTests = LIVE_TESTS) {}

  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<TestConnectionResponse>> {
    const parsed = validate(TestConnectionDraftCommand, input);
    if (!parsed.ok) {
      return parsed;
    }

    const { projectId, newSecrets, ...fields } = parsed.value;
    if (!(await new ProjectRepository(ctx.db, ctx.orgId).findById(projectId))) {
      return fail('not-found', 'Project not found.');
    }

    return testProfile(ctx, this.tests, projectId, fields, newSecrets);
  }
}
