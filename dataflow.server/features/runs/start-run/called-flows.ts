import { dynamicTargets, flowPath, inputTypeRef, isFolderVisible, MAX_FLOW_DEPTH, scriptTypeShape, START, startConfig, validateFlowFile, DYNAMIC_TARGET, type FlowFile, type TypeShape } from '@dataflow/core';
import { readDraft } from '#features/flows/flow-draft';
import type { ProjectTree } from '#features/folders/project-tree';
import { typeSources } from '#features/scripts/script-store';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';

/**
 * A flow a run's Flow Invokers call (directly or through other called flows), as it was when the run was queued: its
 * draft (the published version, once there is one), its whole path (how an expression names it), the Start's input
 * type read from its script, or why it cannot be called (then each call to it is an error of the envelope, on the Flow
 * Invoker's On error).
 */
export type CalledFlow = {
  id: string;
  name: string;
  path?: string;
  flow?: FlowFile;
  inputType?: { name: string; shape: TypeShape };
  unavailable?: string;
  /** taken only because a Flow Invoker names its flow by expression (any flow could be): its problems do not stop the run */
  anyFlow?: true;
};

const INVOKER = 'flow';

/** the flows a flow's Flow Invokers call, by id (one that names its flow by expression: none here) */
const callsOf = (file: FlowFile) =>
  file.nodes
    .filter(n => n.type === INVOKER && typeof n.config.flowId === 'string' && n.config.flowId !== '' && n.config.flowId !== DYNAMIC_TARGET)
    .map(n => n.config.flowId as string);

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
 * refuse, with the chain). Only the project's active flows: an archived or removed one is unavailable. When one of
 * them names the flow it calls by expression, every active flow of the project goes (any could be named), and the
 * root as one that cannot be called (calling it back is circular).
 */
export async function calledFlows(ctx: UseCaseContext, projectId: string, tree: ProjectTree, root: FlowFile): Promise<CalledFlow[]> {
  const found = new Map<string, CalledFlow>();
  const active = (id: string) => {
    const row = tree.flows.find(f => f.id === id);
    return row && !row.archivedAt && isFolderVisible(tree.folders, row.folderId) ? row : undefined;
  };
  /** the flow as the run takes it; the flows it calls in turn */
  const take = async (id: string): Promise<string[]> => {
    const row = active(id);
    if (!row) {
      found.set(id, { id, name: tree.flows.find(f => f.id === id)?.name ?? id, unavailable: 'it was not found (archived or removed).' });
      return [];
    }

    const path = flowPath(tree.folders, row);
    const checked = validateFlowFile(readDraft(row).flow);
    if (!checked.ok) {
      found.set(id, { id, name: row.name, path, unavailable: checked.errors.join(' ') });
      return [];
    }

    const { type, error } = await inputTypeOf(ctx, projectId, checked.value);
    found.set(id, { id, name: row.name, path, flow: checked.value, ...(type ? { inputType: type } : {}), ...(error ? { unavailable: error } : {}) });
    return callsOf(checked.value);
  };

  let level = callsOf(root);
  for (let depth = 1; depth <= MAX_FLOW_DEPTH && level.length > 0; depth++) {
    const next: string[] = [];
    for (const id of new Set(level)) {
      if (!found.has(id) && id !== root.id) next.push(...(await take(id)));
    }

    level = next;
  }

  const byExpression = [root, ...[...found.values()].flatMap(c => (c.flow ? [c.flow] : []))].some(file => dynamicTargets(file.nodes).flows);
  if (byExpression) {
    for (const row of tree.flows) {
      if (row.id !== root.id && !found.has(row.id) && active(row.id)) {
        await take(row.id);
        found.set(row.id, { ...found.get(row.id)!, anyFlow: true });
      }
    }

    const self = root.id ? active(root.id) : undefined;
    if (self) {
      found.set(self.id, { id: self.id, name: self.name, path: flowPath(tree.folders, self), unavailable: 'it is the flow that runs (a call to it is circular).' });
    }
  }

  return [...found.values()];
}
