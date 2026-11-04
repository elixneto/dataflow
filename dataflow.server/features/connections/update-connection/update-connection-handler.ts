import { z } from 'zod';
import { insertSecret } from '#features/secrets/secret-store';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import { toConnectionView, type ConnectionView } from '../connection';
import { checkProfile, ConnectionRepository, ProfileInput, usedSecrets } from '../connection-store';

export const UpdateConnectionCommand = z.object({ id: z.uuid('Invalid'), ...ProfileInput });

/** Saves a connection profile and the secrets typed in its form, all or nothing (see CreateConnectionHandler). */
export class UpdateConnectionHandler implements UseCaseHandler<ConnectionView> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<ConnectionView>> {
    const parsed = validate(UpdateConnectionCommand, input);
    if (!parsed.ok) {
      return parsed;
    }

    const { id, newSecrets, ...fields } = parsed.value;
    const current = await new ConnectionRepository(ctx.db, ctx.orgId).findById(id);
    if (!current) {
      return fail('not-found', 'Connection not found.');
    }

    const checked = await checkProfile(ctx, current.projectId, fields, newSecrets, id);
    if ('failure' in checked) {
      return checked.failure;
    }

    const updated = await ctx.db.transaction(async tx => {
      for (const secret of usedSecrets(checked.value, newSecrets)) {
        await insertSecret(tx, ctx, current.projectId, secret.name, secret.value);
      }

      return new ConnectionRepository(tx, ctx.orgId).update(id, { ...checked.value, updatedAt: new Date(), updatedBy: ctx.userId });
    });

    return updated ? success(toConnectionView(updated)) : fail('not-found', 'Connection not found.');
  }
}
