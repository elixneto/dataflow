import { inputTypeRef, isFolderVisible, MAX_FLOW_DEPTH, scriptTypeShape, START, startConfig, validateFlowFile, type FlowFile, type TypeShape } from '@dataflow/core';
import { readDraft } from '#features/flows/flow-draft';
import type { ProjectTree } from '#features/folders/project-tree';
import { typeSources } from '#features/scripts/script-store';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';

/**
 * A flow a run's Flow Invokers call (directly or through other called flows), as it was when the run was queued: its
 * draft (the published version, once there is one), the Start's input type read from its script, or why it cannot be
 * called (then each call to it is an error of the envelope, on the Flow Invoker's On error).
 */
export type CalledFlow = {
  id: string;
  name: string;
  flow?: FlowFile;
  inputType?: { name: string; shape: TypeShape };
  unavailable?: string;
};

const INVOKER = 'flow';

/** the flows a flow's Flow Invokers call, by id */
const callsOf = (file: FlowFile) =>
  file.nodes.filter(n => n.type === INVOKER && typeof n.config.flowId === 'string' && n.config.flowId !== '').map(n => n.config.flowId as string);

/** The Start's input type of a flow: its shape, null without one, or why it cannot be read. */
async function inputTypeOf(ctx: UseCaseContext, projectId: string, file: FlowFile): Promise<{ type?: CalledFlow['inputType']; error?: string }> {
  const config = file.nodes.find(n => n.type === START)?.config ?? {};
  const ref = startConfig(config).acceptsInput ? inputTypeRef(config.inputType) : null;
  if (!ref) {
    return {};
  }

  const shape = scriptTypeShape(await typeSources(ctx.db, ctx.orgId, projectId, ref.path), ref.path, ref.name);
  return shape ? { type: { name: ref.name, shape } } : { error: `its input type ${ref.name} no longer exists in the script ${ref.path}.` };
}

/**
 * Every flow the root flow calls, down to MAX_FLOW_DEPTH levels, each one once (a circular call is the engine's to
 * refuse, with the chain). Only the project's active flows: an archived or removed one is unavailable.
 */
export async function calledFlows(ctx: UseCaseContext, projectId: string, tree: ProjectTree, root: FlowFile): Promise<CalledFlow[]> {
  const found = new Map<string, CalledFlow>();
  let level = callsOf(root);
  for (let depth = 1; depth <= MAX_FLOW_DEPTH && level.length > 0; depth++) {
    const next: string[] = [];
    for (const id of new Set(level)) {
      if (found.has(id) || id === root.id) {
        continue;
      }

      const row = tree.flows.find(f => f.id === id);
      if (!row || row.archivedAt || !isFolderVisible(tree.folders, row.folderId)) {
        found.set(id, { id, name: row?.name ?? id, unavailable: 'it was not found (archived or removed).' });
        continue;
      }

      const checked = validateFlowFile(readDraft(row).flow);
      if (!checked.ok) {
        found.set(id, { id, name: row.name, unavailable: checked.errors.join(' ') });
        continue;
      }

      const { type, error } = await inputTypeOf(ctx, projectId, checked.value);
      found.set(id, { id, name: row.name, flow: checked.value, ...(type ? { inputType: type } : {}), ...(error ? { unavailable: error } : {}) });
      next.push(...callsOf(checked.value));
    }

    level = next;
  }

  return [...found.values()];
}
