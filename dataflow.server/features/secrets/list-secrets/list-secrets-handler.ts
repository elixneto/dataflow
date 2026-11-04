import { z } from 'zod';
import { GetProjectHandler } from '#features/projects/get-project/get-project-handler';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import { toSecretView, type SecretView } from '../secret';
import { projectSecrets } from '../secret-store';

export const ListSecretsQuery = z.object({ projectId: z.uuid('Invalid') });

/** The project's secrets by name, without their values (flows read them as SECRETS['name']). */
export class ListSecretsHandler implements UseCaseHandler<{ items: SecretView[] }> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<{ items: SecretView[] }>> {
    const parsed = validate(ListSecretsQuery, input);
    if (!parsed.ok) {
      return parsed;
    }

    const project = await new GetProjectHandler().handle({ id: parsed.value.projectId }, ctx);
    if (!project.ok) {
      return project;
    }

    const rows = await projectSecrets(ctx.db, ctx.orgId, parsed.value.projectId);
    return success({ items: rows.sort((a, b) => a.name.localeCompare(b.name, 'en')).map(toSecretView) });
  }
}
