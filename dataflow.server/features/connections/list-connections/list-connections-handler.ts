import { z } from 'zod';
import { withUpdatedByName } from '#features/users/user-names';
import { GetProjectHandler } from '#features/projects/get-project/get-project-handler';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import { toConnectionView, type ConnectionView } from '../connection';
import { ConnectionRepository } from '../connection-store';

export const ListConnectionsQuery = z.object({ projectId: z.uuid('Invalid') });

/** The project's connection profiles by name (their sensitive fields name secrets, never values). */
export class ListConnectionsHandler implements UseCaseHandler<{ items: (ConnectionView & { updatedByName?: string })[] }> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<{ items: (ConnectionView & { updatedByName?: string })[] }>> {
    const parsed = validate(ListConnectionsQuery, input);
    if (!parsed.ok) {
      return parsed;
    }

    const project = await new GetProjectHandler().handle({ id: parsed.value.projectId }, ctx);
    if (!project.ok) {
      return project;
    }

    const rows = await new ConnectionRepository(ctx.db, ctx.orgId).ofProject(parsed.value.projectId);
    return success({ items: await withUpdatedByName(ctx.db, ctx.orgId, rows.map(toConnectionView)) });
  }
}
