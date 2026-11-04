import { z } from 'zod';
import { GetProjectHandler } from '#features/projects/get-project/get-project-handler';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import { loadTree, toFlowView, toFolderView, type FlowView, type FolderView } from '../project-tree';

export const GetProjectContentsQuery = z.object({ projectId: z.uuid('Invalid') });

export type ProjectContentsResponse = { folders: FolderView[]; flows: FlowView[] };

/**
 * Every folder and flow of a project, active and archived (archivedAt says which), as flat lists: the editor builds the
 * tree, the Cards and the Archived list from them. An archived project still lists its contents.
 */
export class GetProjectContentsHandler implements UseCaseHandler<ProjectContentsResponse> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<ProjectContentsResponse>> {
    const parsed = validate(GetProjectContentsQuery, input);
    if (!parsed.ok) {
      return parsed;
    }

    const project = await new GetProjectHandler().handle({ id: parsed.value.projectId }, ctx);
    if (!project.ok) {
      return project;
    }

    const tree = await loadTree(ctx.db, ctx.orgId, parsed.value.projectId);
    return success({ folders: tree.folders.map(toFolderView), flows: tree.flows.map(toFlowView) });
  }
}
