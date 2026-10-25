import type {Edge} from '@xyflow/react';
import type {RunMode, WorkflowParameter, RunRecord, ExecutableWorkflow} from '@dataflow/core';
import {isComponent} from '#editor/validation';
import {getFlow, type FlowNode} from '#data/flows';
import {getProject} from '#data/projects';

/** What the editor has → what the runner receives (no position, comments or anything visual). */
export function toExecutable(name: string, parameters: WorkflowParameter[], nodes: FlowNode[], edges: Edge[], id?: string, projectId?: string): ExecutableWorkflow {
  return {
    id,
    project: (projectId && getProject(projectId)?.name) || 'Draft',
    workflow: name,
    parameters,
    nodes: nodes.filter(isComponent).map(n => ({
      id: n.id, type: n.data.type, label: n.data.label, config: n.data.config,
      outputKey: n.data.outputKey, override: n.data.override, disabled: n.data.disabled, pinned: n.data.pinned,
    })),
    edges: edges.map(e => ({
      source: e.source, sourcePort: e.sourceHandle ?? 'out-0', target: e.target, targetPort: e.targetHandle ?? 'in-0',
    })),
  };
}

/**
 * Workflows this one calls through the Workflow Invoker, and the ones those call (as they are saved). They go along to the
 * runner while the flows live in the browser; the runner blocks whatever calls itself.
 */
export function calledWorkflows(root: ExecutableWorkflow): Record<string, ExecutableWorkflow> {
  const found: Record<string, ExecutableWorkflow> = {};
  const pending = [root];
  while (pending.length) {
    const current = pending.pop()!;
    for (const node of current.nodes.filter(n => n.type === 'workflow')) {
      const id = String(node.config.workflowId ?? '');
      if (!id || found[id]) continue;
      const flow = id === root.id ? undefined : getFlow(id);
      const wf = flow ? toExecutable(flow.name, flow.parameters ?? [], flow.nodes, flow.edges, flow.id, flow.projectId) : id === root.id ? root : undefined;
      if (!wf) continue;
      found[id] = wf;
      pending.push(wf);
    }
  }
  return found;
}

/** Test input of the Start (JSON), when it accepts input; undefined if it does not or it is empty. */
export function testInputOf(workflow: ExecutableWorkflow): unknown {
  const start = workflow.nodes.find(n => n.type === 'start');
  if (start?.config.acceptsInput !== true) return undefined;
  const text = String(start.config.testInput ?? '').trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('The Start test input is not valid JSON.');
  }
}

const NOT_RESPONDING = 'The runner did not respond. Is it running? (npm run start at the repository root)';

/** Calls the runner. In dev, Vite forwards /api to http://localhost:5190. */
export async function runOnRunner(workflow: ExecutableWorkflow, mode: RunMode, id: string, parameters?: Record<string, string>, projectId?: string): Promise<RunRecord> {
  const input = testInputOf(workflow);
  let response: Response;
  try {
    response = await fetch(`${import.meta.env.BASE_URL}api/runs`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({id, workflow, mode, parameters, input, projectId, workflows: calledWorkflows(workflow)}),
    });
  } catch {
    throw new Error(NOT_RESPONDING);
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(response.status === 502 || response.status === 504 || text.includes('ECONNREFUSED')
      ? NOT_RESPONDING
      : `The runner returned ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.json() as Promise<RunRecord>;
}

/** Stop button: asks the runner to interrupt the run (the Run response arrives as "Run cancelled."). */
export async function cancelOnRunner(id: string) {
  await fetch(`${import.meta.env.BASE_URL}api/runs/${encodeURIComponent(id)}/cancel`, {method: 'POST'}).catch(() => undefined);
}
