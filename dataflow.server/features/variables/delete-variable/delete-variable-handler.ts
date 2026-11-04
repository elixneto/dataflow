import { z } from 'zod';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import { VariableRepository } from '../variable-repository';

export const DeleteVariableCommand = z.object({ id: z.uuid('Invalid') });

/** Deletes a variable: flows that read it get nothing until it exists again. */
export class DeleteVariableHandler implements UseCaseHandler<{ id: string }> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<{ id: string }>> {
    const parsed = validate(DeleteVariableCommand, input);
    if (!parsed.ok) {
      return parsed;
    }

    const { id } = parsed.value;
    return (await new VariableRepository(ctx.db, ctx.orgId).remove(id)) ? success({ id }) : fail('not-found', 'Variable not found.');
  }
}
