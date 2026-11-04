import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import { ProjectRepository } from '../project-repository';
import { CreateProjectCommand, type CreateProjectResponse } from './create-project-command';

/** Creates a project in the caller's organization. Names are unique per organization among live projects. */
export class CreateProjectHandler implements UseCaseHandler<CreateProjectResponse> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<CreateProjectResponse>> {
    const parsed = validate(CreateProjectCommand, input);
    if (!parsed.ok) {
      return parsed;
    }

    const command = parsed.value;
    const projects = new ProjectRepository(ctx.db, ctx.orgId);
    if (await projects.existsByName(command.name)) {
      return fail('conflict', `A project named "${command.name}" already exists.`, { name: 'Already in use' });
    }

    const project = await projects.insert({ id: crypto.randomUUID(), ...command });
    return success({ id: project.id });
  }
}
