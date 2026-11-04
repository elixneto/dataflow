import { z } from 'zod';
import { requireActiveProject } from '#features/folders/project-tree';
import { insertSecret } from '#features/secrets/secret-store';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import { checkProfile, ConnectionRepository, ProfileInput, usedSecrets } from '../connection-store';

export const CreateConnectionCommand = z.object({ projectId: z.uuid('Invalid'), ...ProfileInput });

/**
 * A new connection profile in an active project, with the secrets typed in its form ("+ New"): all checked first,
 * then written in one transaction, so a failure leaves neither the profile nor its new secrets.
 */
export class CreateConnectionHandler implements UseCaseHandler<{ id: string }> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<{ id: string }>> {
    const parsed = validate(CreateConnectionCommand, input);
    if (!parsed.ok) {
      return parsed;
    }

    const { projectId, newSecrets, ...fields } = parsed.value;
    const missing = await requireActiveProject(ctx, projectId);
    if (missing) {
      return missing;
    }

    const checked = await checkProfile(ctx, projectId, fields, newSecrets);
    if ('failure' in checked) {
      return checked.failure;
    }

    const id = crypto.randomUUID();
    await ctx.db.transaction(async tx => {
      for (const secret of usedSecrets(checked.value, newSecrets)) {
        await insertSecret(tx, ctx, projectId, secret.name, secret.value);
      }

      await new ConnectionRepository(tx, ctx.orgId).insert({ id, projectId, ...checked.value, updatedBy: ctx.userId });
    });

    return success({ id });
  }
}
