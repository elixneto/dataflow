import { z } from 'zod';
import { secretNameError, variableValueError } from '@dataflow/core';
import { requireActiveProject } from '#features/folders/project-tree';
import { fieldErrors } from '#shared/use-cases/field-errors';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import { VariableRepository } from '../variable-repository';

export const CreateVariableCommand = z.object({ projectId: z.uuid('Invalid'), name: z.string().trim(), value: z.string() });

/**
 * A new variable in an active project. Names follow the secrets' rule (@dataflow/core), unique among the project's
 * variables; a variable and a secret may share a name (ENV_VARIABLES and SECRETS are apart).
 */
export class CreateVariableHandler implements UseCaseHandler<{ id: string }> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<{ id: string }>> {
    const parsed = validate(CreateVariableCommand, input);
    if (!parsed.ok) {
      return parsed;
    }

    const { projectId, name, value } = parsed.value;
    const missing = await requireActiveProject(ctx, projectId);
    if (missing) {
      return missing;
    }

    const repository = new VariableRepository(ctx.db, ctx.orgId);
    const invalid = fieldErrors({ name: secretNameError(name, await repository.ofProject(projectId)), value: variableValueError(value) });
    if (invalid) {
      return invalid;
    }

    const variable = await repository.insert({ id: crypto.randomUUID(), projectId, name, value, updatedBy: ctx.userId });
    return success({ id: variable.id });
  }
}
