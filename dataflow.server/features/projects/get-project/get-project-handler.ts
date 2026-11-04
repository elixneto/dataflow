import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import { projects } from '../project';
import { toProjectView, type ProjectView } from '../project-fields';
import { ProjectRepository } from '../project-repository';

export const GetProjectQuery = z.object({ id: z.uuid('Invalid') });

/** One project of the organization, active or archived (archivedAt says which). */
export class GetProjectHandler implements UseCaseHandler<ProjectView> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<ProjectView>> {
    const parsed = validate(GetProjectQuery, input);
    if (!parsed.ok) {
      return parsed;
    }

    const { id } = parsed.value;
    const repository = new ProjectRepository(ctx.db, ctx.orgId);
    const project = (await repository.findById(id)) ?? (await repository.findDeleted(eq(projects.id, id), { limit: 1 }))[0];
    return project ? success(toProjectView(project)) : fail('not-found', 'Project not found.');
  }
}
