import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import { toProjectView } from '../project-fields';
import { ProjectRepository } from '../project-repository';
import { UpdateProjectCommand, type UpdateProjectResponse } from './update-project-command';

/** Changes an active project's name, description, icon or color. The name stays unique among live projects. */
export class UpdateProjectHandler implements UseCaseHandler<UpdateProjectResponse> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<UpdateProjectResponse>> {
    const parsed = validate(UpdateProjectCommand, input);
    if (!parsed.ok) {
      return parsed;
    }

    const { id, ...changes } = parsed.value;
    const projects = new ProjectRepository(ctx.db, ctx.orgId);
    if (changes.name !== undefined && (await projects.existsByName(changes.name, id))) {
      return fail('conflict', `A project named "${changes.name}" already exists.`, { name: 'Already in use' });
    }

    const project = await projects.update(id, changes);
    if (!project) {
      return fail('not-found', 'Project not found.');
    }

    return success(toProjectView(project));
  }
}
