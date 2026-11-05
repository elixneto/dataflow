/*
 * The run history (the Runs page): the organization's runs for real, each one on its own, linked to the run that queued
 * it (a Flow Invoker's fire and forget batch: parentId) and to the run at the top of those calls (rootId). The list shows
 * the top runs; each one opens on the runs it queued, down the tree, every one with its own status: a run can have
 * completed while the runs it queued still run, or failed.
 */

export type RunStatus = 'queued' | 'running' | 'completed' | 'with-warnings' | 'with-errors' | 'failed' | 'cancelled';

export type RunTrigger = 'manual' | 'schedule' | 'webhook' | 'api' | 'flow-invoker';

/** a run as the history lists it (the server's runs row, without its record) */
export type RunSummary = {
  id: string;
  status: RunStatus;
  trigger: RunTrigger;
  projectId: string;
  projectName: string;
  flowId: string;
  flowName: string;
  /** who started it: a user (manual), or nobody (a schedule, a webhook, a call) */
  startedBy?: string;
  queuedAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  /** none while it goes on */
  durationMs?: number;
  /** envelopes the Start sent → envelopes that reached the End (as the editor's run panel) */
  envelopesIn?: number;
  envelopesOut?: number;
  error?: string;
  /** which supervisor and worker ran it */
  workerId?: string;
  /** a fire and forget batch: the run that queued it, the one at the top, and the Flow Invoker that called it */
  parentId?: string;
  rootId?: string;
  calledBy?: string;
  /** envelopes in its batch */
  batchSize?: number;
};

/** a run with the runs it queued, down the tree */
export type RunNode = RunSummary & { children: RunNode[] };

export const RUN_STATUSES: RunStatus[] = ['queued', 'running', 'completed', 'with-warnings', 'with-errors', 'failed', 'cancelled'];

/** what ended badly: an error to look at */
export const isProblem = (status: RunStatus) => status === 'failed' || status === 'with-errors';

/** not over yet */
export const isOpen = (status: RunStatus) => status === 'queued' || status === 'running';

/**
 * The runs as trees: each run under the run that queued it, the newest first at each level. A run whose parent is not
 * in the list (a page further, or filtered out) stands at the top.
 */
export function runTree(runs: RunSummary[]): RunNode[] {
  const nodes = new Map(runs.map(run => [run.id, { ...run, children: [] as RunNode[] }]));
  const roots: RunNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }

  const sort = (list: RunNode[], newestFirst: boolean) => {
    list.sort((a, b) => (newestFirst ? -1 : 1) * (a.queuedAt.getTime() - b.queuedAt.getTime()));
    // the runs a run queued, in the order it queued them (its batches 1, 2, 3...)
    list.forEach(n => sort(n.children, false));
  };
  sort(roots, true);
  return roots;
}

/** every run a run queued, down the tree (not itself) */
export function descendants(node: RunNode): RunNode[] {
  return node.children.flatMap(child => [child, ...descendants(child)]);
}

/** how the runs a run queued are going: how many of each status, in the order of RUN_STATUSES */
export function statusCounts(runs: RunSummary[]): { status: RunStatus; count: number }[] {
  return RUN_STATUSES.map(status => ({ status, count: runs.filter(r => r.status === status).length })).filter(c => c.count > 0);
}

/** how far back the Runs page looks: its numbers, and the top runs it lists */
export type RunPeriod = '24h' | '7d';
export const RUN_PERIOD_LABEL: Record<RunPeriod, string> = { '24h': 'Last 24 hours', '7d': 'Last 7 days' };

export type RunFilter = {
  /** open: queued or running; problems: failed or with errors (the run itself or one it queued) */
  status: 'all' | 'open' | 'problems' | RunStatus;
  projectId: string;
  trigger: 'all' | RunTrigger;
  /** a run id (whole or its start), or part of a flow's name */
  search: string;
  /** only the top runs queued in it (none: any time, as a link to a run asks) */
  period?: RunPeriod;
};

export const EMPTY_FILTER: RunFilter = { status: 'all', projectId: '', trigger: 'all', search: '' };

/** the short form of a run id, as the list shows it (the whole one on hover, copy and in the details) */
export const shortId = (id: string) => id.slice(0, 8);

/** the top run of a run's tree, among these roots */
export function rootOf(roots: RunNode[], id: string): RunNode | undefined {
  return roots.find(root => root.id === id || descendants(root).some(r => r.id === id));
}

/** a run of a tree, by id (the root itself or one under it) */
export function findIn(root: RunNode, id: string): RunNode | undefined {
  return root.id === id ? root : descendants(root).find(r => r.id === id);
}

/** the runs of a tree, top first, each with how deep it is (the top 0) */
export function flatten(node: RunNode, depth = 0): { run: RunNode; depth: number }[] {
  return [{ run: node, depth }, ...node.children.flatMap(child => flatten(child, depth + 1))];
}
