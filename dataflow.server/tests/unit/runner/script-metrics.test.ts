import { expect, test } from 'bun:test';
import { flowRunner, newFlowFile, toExecutableFlow } from '@dataflow/core';
import { evaluate } from '#shared/runner/evaluate';
import { prepareScript } from '#shared/runner/prepare-script';

/** a TypeScript component that sleeps: its Metrics say it waited, not that it worked */
test('in the metrics, what a script waits for is Waiting; only its own work is Active', async () => {
  const file = newFlowFile('Sleeps');
  const [start, end] = file.nodes;
  const flow = toExecutableFlow(
    {
      ...file,
      nodes: [
        { ...start!, config: { acceptsInput: true } },
        { id: 'ts', type: 'typescript', position: { x: 0, y: 0 }, config: { code: `async function process($input) { await new Promise(r => setTimeout(r, 300)); return 1; }` } },
        end!,
      ],
      edges: [
        { source: start!.id, sourcePort: 'out-0', target: 'ts', targetPort: 'in-0' },
        { source: 'ts', sourcePort: 'out-0', target: end!.id, targetPort: 'in-0' },
      ],
    },
    'P',
  );
  const record = await flowRunner(flow, { mode: 'validation', id: 'm1', evaluate, input: [{ a: 1 }], prepareScript: (code, globals) => prepareScript(code, globals) });
  const ts = record.components.find(c => c.nodeId === 'ts')!;
  expect(record.status).toBe('completed');
  expect(ts.waitingMs).toBeGreaterThanOrEqual(280);
  expect(ts.activeTimeMs!).toBeLessThan(150);
});
