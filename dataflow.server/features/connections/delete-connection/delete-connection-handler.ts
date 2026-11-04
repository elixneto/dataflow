import { z } from 'zod';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import { ConnectionRepository } from '../connection-store';

export const DeleteConnectionCommand = z.object({ id: z.uuid('Invalid') });

/** Deletes a connection profile; its secrets stay (other profiles or flows may use them). */
export class DeleteConnectionHandler implements UseCaseHandler<{ id: string }> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<{ id: string }>> {
    const parsed = validate(DeleteConnectionCommand, input);
    if (!parsed.ok) {
      return parsed;
    }

    const { id } = parsed.value;
    return (await new ConnectionRepository(ctx.db, ctx.orgId).remove(id)) ? success({ id }) : fail('not-found', 'Connection not found.');
  }
}
