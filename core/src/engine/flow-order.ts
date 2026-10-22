import {END, START} from '#engine/constants';
import type {ExecutableWorkflow} from '#types/executable-workflow.type';

/**
 * Flow order (Start → ... → End), so the record lists the components in the order the envelopes pass through.
 * Components run at the same time, so the start time is useless: in a fast flow they all start in the same ms.
 * Kahn over the edges; ties by node order; whatever is not connected goes to the end.
 */
export function flowOrder(wf: ExecutableWorkflow): string[] {
  const degree = new Map(wf.nodes.map(n => [n.id, 0]));
  for (const e of wf.edges) degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  const connected = new Set(wf.edges.flatMap(e => [e.source, e.target]));
  const queue = wf.nodes.filter(n => degree.get(n.id) === 0 && (connected.has(n.id) || n.type === START)).map(n => n.id);
  const order: string[] = [];
  while (queue.length) {
    const current = queue.shift()!;
    order.push(current);
    for (const e of wf.edges.filter(x => x.source === current)) {
      const d = (degree.get(e.target) ?? 0) - 1;
      degree.set(e.target, d);
      if (d === 0) queue.push(e.target);
    }
  }
  // End last when it receives from several branches; cycles and loose nodes at the end, in node order
  const rest = wf.nodes.map(n => n.id).filter(id => !order.includes(id));
  const withoutEnd = order.filter(id => wf.nodes.find(n => n.id === id)?.type !== END);
  const ends = order.filter(id => wf.nodes.find(n => n.id === id)?.type === END);
  return [...withoutEnd, ...ends, ...rest];
}
