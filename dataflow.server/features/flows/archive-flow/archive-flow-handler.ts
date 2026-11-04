import { z } from 'zod';
import { FlowRepository } from '#features/folders/project-tree';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';

export const ArchiveFlowCommand = z.object({ id: z.uuid('Invalid') });

/** Archives an active flow (soft delete: the row stays, so its versions and history keep pointing at it). */
export class ArchiveFlowHandler implements UseCaseHandler<{ id: string }> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<{ id: string }>> {
    const parsed = validate(ArchiveFlowCommand, input);
    if (!parsed.ok) {
      return parsed;
    }

    const { id } = parsed.value;
    if (!(await new FlowRepository(ctx.db, ctx.orgId).softDelete(id, ctx.userId))) {
      return fail('not-found', 'Flow not found.');
    }

    return success({ id });
  }
}
