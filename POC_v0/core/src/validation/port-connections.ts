/**
 * Each port takes a single edge: one output goes to one input (to send the same envelopes to several, a Copy), and an
 * input gets one output (to merge several, a Union). Only the End's input takes several. The editor already refuses
 * such an edge when it is drawn; this also covers a flow that did not come from the canvas (pasted, imported, the API).
 * Returns one issue per crowded port, without the component's name (the caller puts it in front).
 */
export function portConnectionIssues(
  edges: {source: string; sourcePort: string; target: string; targetPort: string}[],
  takesSeveral: (nodeId: string) => boolean,
): {nodeId: string; message: string}[] {
  const count = (keys: string[]) => keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>());
  const issues: {nodeId: string; message: string}[] = [];
  const name = (port: string) => (/^(in|out)-\d+$/.test(port) ? String(Number(port.split('-')[1]) + 1) : `"${port}"`);
  for (const [key, n] of count(edges.map(e => `${e.source}\n${e.sourcePort}`))) {
    if (n < 2) continue;
    const [nodeId, port] = key.split('\n');
    issues.push({nodeId, message: `has output ${name(port)} with ${n} connections: each output goes to one input (use a Copy to send to several).`});
  }
  for (const [key, n] of count(edges.map(e => `${e.target}\n${e.targetPort}`))) {
    const [nodeId, port] = key.split('\n');
    if (n < 2 || takesSeveral(nodeId)) continue;
    issues.push({nodeId, message: `has input ${name(port)} with ${n} connections: merge them with a Union first.`});
  }
  return issues;
}
