import { z } from 'zod';
import { variableValueError } from '@dataflow/core';
import { fieldErrors } from '#shared/use-cases/field-errors';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import { toVariableView, type VariableView } from '../variable';
import { VariableRepository } from '../variable-repository';

export const UpdateVariableCommand = z.object({ id: z.uuid('Invalid'), value: z.string() });

/** Changes a variable's value; the name stays (flows refer to it). */
export class UpdateVariableHandler implements UseCaseHandler<VariableView> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<VariableView>> {
    const parsed = validate(UpdateVariableCommand, input);
    if (!parsed.ok) {
      return parsed;
    }

    const invalid = fieldErrors({ value: variableValueError(parsed.value.value) });
    if (invalid) {
      return invalid;
    }

    const updated = await new VariableRepository(ctx.db, ctx.orgId).update(parsed.value.id, {
      value: parsed.value.value,
      updatedAt: new Date(),
      updatedBy: ctx.userId,
    });
    return updated ? success(toVariableView(updated)) : fail('not-found', 'Variable not found.');
  }
}
