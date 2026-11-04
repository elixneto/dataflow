import { z } from 'zod';
import { secretNameError, secretValueError } from '@dataflow/core';
import { requireActiveProject } from '#features/folders/project-tree';
import { fieldErrors } from '#shared/use-cases/field-errors';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import { insertSecret, projectSecrets } from '../secret-store';

export const CreateSecretCommand = z.object({ projectId: z.uuid('Invalid'), name: z.string().trim(), value: z.string() });

/**
 * A new secret in an active project: the value is encrypted and never shown again. The name rule (and unique in the
 * project, ignoring case) is @dataflow/core's, the same the editor shows.
 */
export class CreateSecretHandler implements UseCaseHandler<{ id: string }> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<{ id: string }>> {
    const parsed = validate(CreateSecretCommand, input);
    if (!parsed.ok) {
      return parsed;
    }

    const { projectId, name, value } = parsed.value;
    const missing = await requireActiveProject(ctx, projectId);
    if (missing) {
      return missing;
    }

    const invalid = fieldErrors({ name: secretNameError(name, await projectSecrets(ctx.db, ctx.orgId, projectId)), value: secretValueError(value) });
    if (invalid) {
      return invalid;
    }

    const secret = await insertSecret(ctx.db, ctx, projectId, name, value);
    return success({ id: secret.id });
  }
}
