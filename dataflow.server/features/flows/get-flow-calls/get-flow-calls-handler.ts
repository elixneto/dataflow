import { z } from 'zod';
import { callCycles, flowCalls, flowScriptUses, folderPath, isFolderVisible, scriptLinks, toExecutableFlow, type FlowCall, type ScriptUse } from '@dataflow/core';
import { readDraft } from '#features/flows/flow-draft';
import { loadTree } from '#features/folders/project-tree';
import { GetProjectHandler } from '#features/projects/get-project/get-project-handler';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';

const INVOKER = 'flow';

export const GetFlowCallsQuery = z.object({ projectId: z.uuid('Invalid') });

/** a flow of the project as the calls name it: where it is, and whether it can be called (active, in an active folder) */
export type CalledFlowView = { id: string; name: string; folder: string; available: boolean };

export type FlowCallsResponse = {
  flows: CalledFlowView[];
  /** every Flow Invoker call of the project's active flows, from their drafts (a call to a flow not listed: removed) */
  calls: FlowCall[];
  /** each circular chain of calls once (a → b → a) */
  cycles: string[][];
  /** the project's scripts (paths) */
  scripts: string[];
  /** the scripts the active flows use: imported by a TypeScript component, or named as a type (the Start's input type) */
  scriptUses: ScriptUse[];
  /** what each script imports from the others */
  scriptImports: { from: string; to: string }[];
};

/**
 * The calls between a project's flows (their Flow Invokers), read from the drafts (the version a run calls for now),
 * with the circular chains among them, and the project scripts they use (and those import): the editor shows what a
 * flow uses and what uses it from this.
 */
export class GetFlowCallsHandler implements UseCaseHandler<FlowCallsResponse> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<FlowCallsResponse>> {
    const parsed = validate(GetFlowCallsQuery, input);
    if (!parsed.ok) {
      return parsed;
    }

    const project = await new GetProjectHandler().handle({ id: parsed.value.projectId }, ctx);
    if (!project.ok) {
      return project;
    }

    const tree = await loadTree(ctx.db, ctx.orgId, parsed.value.projectId);
    const available = (row: (typeof tree.flows)[number]) => !row.archivedAt && isFolderVisible(tree.folders, row.folderId);
    const flows = tree.flows.map(row => ({
      id: row.id,
      name: row.name,
      folder: row.folderId ? folderPath(tree.folders, row.folderId).map(f => f.name).join(' / ') : '',
      available: available(row),
    }));
    // only the flows that can run make calls; an archived one still names what it pointed at
    // a component left with its default name is named as such (not by its type: "flow", "start", "typescript")
    const DEFAULT_NAMES: Record<string, string> = { [INVOKER]: 'Flow Invoker', start: 'Start', typescript: 'TypeScript' };
    const named = (label: string | undefined) => (label !== undefined && DEFAULT_NAMES[label]) || label;
    const active = tree.flows.filter(available).map(row => toExecutableFlow(readDraft(row).flow, project.value.name));
    const scripts = await ctx.db.query<{ path: string; content: string }>('SELECT path, content FROM scripts WHERE org_id = $1 AND project_id = $2 ORDER BY path', [
      ctx.orgId,
      parsed.value.projectId,
    ]);
    const calls = flowCalls(active).map(c => ({
      ...c,
      nodeLabel: named(c.nodeLabel)!,
      ...(c.onErrorOfLabel ? { onErrorOfLabel: named(c.onErrorOfLabel) } : {}),
    }));
    const scriptUses = flowScriptUses(active).map(u => ({ ...u, nodeLabel: named(u.nodeLabel)! }));
    return success({ flows, calls, cycles: callCycles(calls), scripts: scripts.map(s => s.path), scriptUses, scriptImports: scriptLinks(scripts) });
  }
}
