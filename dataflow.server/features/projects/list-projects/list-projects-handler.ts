import { z } from 'zod';
import { desc } from 'drizzle-orm';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import { projects } from '../project';
import { toProjectView, type ProjectView } from '../project-fields';
import { ProjectRepository } from '../project-repository';

export const ListProjectsQuery = z.object({
  status: z.enum(['active', 'archived'], 'Use active or archived').default('active'),
});

export type ListProjectsResponse = { items: ProjectView[] };

/** The organization's active projects (newest first) or archived ones (last archived first). */
export class ListProjectsHandler implements UseCaseHandler<ListProjectsResponse> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<ListProjectsResponse>> {
    const parsed = validate(ListProjectsQuery, input ?? {});
    if (!parsed.ok) {
      return parsed;
    }

    const repository = new ProjectRepository(ctx.db, ctx.orgId);
    const rows = parsed.value.status === 'active'
      ? await repository.findMany(undefined, { orderBy: desc(projects.createdAt) })
      : await repository.findDeleted(undefined, { orderBy: desc(projects.deletedAt) });

    return success({ items: rows.map(toProjectView) });
  }
}
