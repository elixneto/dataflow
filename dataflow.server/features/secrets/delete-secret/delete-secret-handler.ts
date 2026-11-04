import { z } from 'zod';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import { SecretRepository } from '../secret-store';

export const DeleteSecretCommand = z.object({ id: z.uuid('Invalid') });

/** Deletes a secret: flows and connections that name it fail until a secret with that name exists again. */
export class DeleteSecretHandler implements UseCaseHandler<{ id: string }> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<{ id: string }>> {
    const parsed = validate(DeleteSecretCommand, input);
    if (!parsed.ok) {
      return parsed;
    }

    const { id } = parsed.value;
    return (await new SecretRepository(ctx.db, ctx.orgId).remove(id)) ? success({ id }) : fail('not-found', 'Secret not found.');
  }
}
