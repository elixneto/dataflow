import type {ExecutableWorkflow, RunRecord} from '@dataflow/core';

/** A component whose output can be replayed: it ran in the last run and did not fail. */
const replayable = (status: string | undefined) => status !== undefined && status !== 'not-run' && status !== 'failed';

/**
 * The workflow to run from one node, reusing the last run: only that node and what comes after it run. Each node
 * outside that part with an edge into it is pinned with what went out of it in the last run (its own pin, if it has one;
 * otherwise the run's output sample of the ports that feed the part). Null when one of those nodes has nothing to replay.
 */
export function runFromWorkflow(wf: ExecutableWorkflow, nodeId: string, last: RunRecord): ExecutableWorkflow | null {
  const part = new Set([nodeId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const e of wf.edges) {
      if (part.has(e.source) && !part.has(e.target)) {
        part.add(e.target);
        grew = true;
      }
    }
  }
  const edges = wf.edges.filter(e => part.has(e.target));
  const feeding = new Map<string, Set<string>>();
  for (const e of edges.filter(x => !part.has(x.source))) (feeding.get(e.source) ?? feeding.set(e.source, new Set()).get(e.source)!).add(e.sourcePort);
  const boundary = [];
  for (const [id, ports] of feeding) {
    const node = wf.nodes.find(n => n.id === id);
    if (!node) return null;
    if (node.pinned) {
      boundary.push(node);
      continue;
    }
    const ran = last.components.find(c => c.nodeId === id);
    if (!replayable(ran?.status)) return null;
    boundary.push({...node, pinned: Object.fromEntries([...ports].map(p => [p, ran!.outputSample[p] ?? []]))});
  }
  return {...wf, nodes: [...boundary, ...wf.nodes.filter(n => part.has(n.id))], edges};
}
