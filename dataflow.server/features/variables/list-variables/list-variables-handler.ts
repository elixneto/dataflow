import { z } from 'zod';
import { withUpdatedByName } from '#features/users/user-names';
import { GetProjectHandler } from '#features/projects/get-project/get-project-handler';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import { toVariableView, type VariableView } from '../variable';
import { VariableRepository } from '../variable-repository';

export const ListVariablesQuery = z.object({ projectId: z.uuid('Invalid') });

/** The project's variables by name, with their values (flows read them as VARIABLES['name']). */
export class ListVariablesHandler implements UseCaseHandler<{ items: VariableView[] }> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<{ items: VariableView[] }>> {
    const parsed = validate(ListVariablesQuery, input);
    if (!parsed.ok) {
      return parsed;
    }

    const project = await new GetProjectHandler().handle({ id: parsed.value.projectId }, ctx);
    if (!project.ok) {
      return project;
    }

    const rows = await new VariableRepository(ctx.db, ctx.orgId).ofProject(parsed.value.projectId);
    return success({ items: await withUpdatedByName(ctx.db, ctx.orgId, rows.map(toVariableView)) });
  }
}
