import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { FlowRepository, toFlowView, type FlowView } from '#features/folders/project-tree';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import { flows } from '../flow';

export const GetFlowQuery = z.object({ id: z.uuid('Invalid') });

/** One flow of the organization, active or archived (its draft comes with the editor, later). */
export class GetFlowHandler implements UseCaseHandler<FlowView> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<FlowView>> {
    const parsed = validate(GetFlowQuery, input);
    if (!parsed.ok) {
      return parsed;
    }

    const [flow] = await new FlowRepository(ctx.db, ctx.orgId).findAll(eq(flows.id, parsed.value.id));
    return flow ? success(toFlowView(flow)) : fail('not-found', 'Flow not found.');
  }
}
