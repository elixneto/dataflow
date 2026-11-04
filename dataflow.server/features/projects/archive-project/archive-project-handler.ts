import { z } from 'zod';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import { ProjectRepository } from '../project-repository';

export const ArchiveProjectCommand = z.object({ id: z.uuid('Invalid') });

/** Archives an active project (soft delete: the row stays, with who archived it and when). */
export class ArchiveProjectHandler implements UseCaseHandler<{ id: string }> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<{ id: string }>> {
    const parsed = validate(ArchiveProjectCommand, input);
    if (!parsed.ok) {
      return parsed;
    }

    const { id } = parsed.value;
    if (!(await new ProjectRepository(ctx.db, ctx.orgId).softDelete(id, ctx.userId))) {
      return fail('not-found', 'Project not found.');
    }

    return success({ id });
  }
}
