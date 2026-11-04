import {END, START} from '#engine/constants';
import {takesSeveral, type PortEdge} from './ports';

/**
 * The connection rules of ports.ts over a whole flow: every port takes several edges except the single ones (Lookup's
 * inputs); the same two ports are not connected twice; the Start never goes straight to the End. The editor already
 * refuses such an edge when it is drawn; this also covers a flow that did not come from the canvas (pasted, imported,
 * the API). `typeOf` gives a node's component type. Returns one issue per crowded port or wrong edge, without the
 * component's name (the caller puts it in front).
 */
export function portConnectionIssues(edges: PortEdge[], typeOf: (nodeId: string) => string | undefined): {nodeId: string; message: string}[] {
  const count = (keys: string[]) => keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>());
  const issues: {nodeId: string; message: string}[] = [];
  const name = (port: string) => (/^(in|out)-\d+$/.test(port) ? String(Number(port.split('-')[1]) + 1) : `"${port}"`);

  for (const [key, n] of count(edges.map(e => `${e.source}\n${e.sourcePort}`))) {
    const [nodeId, port] = key.split('\n') as [string, string];
    if (n <= 1 || takesSeveral(typeOf(nodeId), 'source', port)) continue;
    issues.push({nodeId, message: `has output ${name(port)} with ${n} connections: it takes one only.`});
  }

  for (const [key, n] of count(edges.map(e => `${e.target}\n${e.targetPort}`))) {
    const [nodeId, port] = key.split('\n') as [string, string];
    if (n <= 1 || takesSeveral(typeOf(nodeId), 'target', port)) continue;
    issues.push({nodeId, message: `has input ${name(port)} with ${n} connections: it takes one only.`});
  }

  for (const [key, n] of count(edges.map(e => `${e.source}\n${e.sourcePort}\n${e.target}\n${e.targetPort}`))) {
    const [nodeId, port] = key.split('\n') as [string, string];
    if (n > 1) issues.push({nodeId, message: `has output ${name(port)} connected ${n} times to the same input.`});
  }

  for (const e of edges) {
    if (typeOf(e.source) === START && typeOf(e.target) === END) issues.push({nodeId: e.source, message: 'goes straight to the End: put at least one component between them.'});
  }

  return issues;
}
