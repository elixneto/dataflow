import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import { projects } from '../project';
import { toProjectView, type ProjectView } from '../project-fields';
import { ProjectRepository } from '../project-repository';

export const RestoreProjectCommand = z.object({ id: z.uuid('Invalid') });

/** Brings an archived project back. Refused when an active project took its name meanwhile. */
export class RestoreProjectHandler implements UseCaseHandler<ProjectView> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<ProjectView>> {
    const parsed = validate(RestoreProjectCommand, input);
    if (!parsed.ok) {
      return parsed;
    }

    const { id } = parsed.value;
    const repository = new ProjectRepository(ctx.db, ctx.orgId);
    const [archived] = await repository.findDeleted(eq(projects.id, id), { limit: 1 });
    if (!archived) {
      return fail('not-found', 'Archived project not found.');
    }

    if (await repository.existsByName(archived.name)) {
      return fail('conflict', `An active project is already named "${archived.name}". Rename it first.`, { name: 'Already in use' });
    }

    const restored = await repository.restore(id);
    return restored ? success(toProjectView(restored)) : fail('not-found', 'Archived project not found.');
  }
}
