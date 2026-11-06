import { expect, test } from 'bun:test';
import { flowRunner, newFlowFile, toExecutableFlow } from '@dataflow/core';
import { evaluate } from '#shared/runner/evaluate';
import { prepareScript } from '#shared/runner/prepare-script';

const SCRIPTS = {
  'math/ops': `import { round } from '@myproject/scripts/math/round';
export async function total(price: number, quantity: number, discount = 0): Promise<number> {
  return round(price * quantity * (1 - discount));
}
export function process(label: string) { return 'named process: ' + label; }`,
  'math/round': `export const round = (n: number) => Math.round(n * 100) / 100;`,
};

/** a flow whose Script Invoker calls `target` with `args`, once per input envelope */
const flowCalling = (target: string, args: unknown[]) => {
  const file = newFlowFile('Calls');
  const [start, end] = file.nodes;
  return toExecutableFlow(
    {
      ...file,
      nodes: [
        { ...start!, config: { acceptsInput: true } },
        { id: 's', type: 'script', position: { x: 0, y: 0 }, config: { function: target, arguments: args } },
        end!,
      ],
      edges: [
        { source: start!.id, sourcePort: 'out-0', target: 's', targetPort: 'in-0' },
        { source: 's', sourcePort: 'out-0', target: end!.id, targetPort: 'in-0' },
      ],
    },
    'P',
  );
};

test("a Script Invoker runs the script's function in the worker's runner (its imports too), its default for an empty argument", async () => {
  const flow = flowCalling('math/ops#total', [
    { name: 'price', type: 'number', value: '$price', expression: true },
    { name: 'quantity', type: 'number', value: '3', expression: false },
    { name: 'discount', type: '', value: '', expression: false },
  ]);
  const record = await flowRunner(flow, {
    mode: 'validation', id: 'si', evaluate, input: [{ price: 1.111 }, { price: 10 }],
    prepareScript: (code, globals) => prepareScript(code, globals, SCRIPTS),
  });
  expect(record.status).toBe('completed');
  expect(record.components.find(c => c.nodeId === 's')!.outputSample['out-0']).toEqual([{ price: 1.111, result: 3.33 }, { price: 10, result: 30 }]);
});

test('a function named process does not clash with the call around it', async () => {
  const record = await flowRunner(flowCalling('math/ops#process', [{ name: 'label', type: 'string', value: 'x', expression: false }]), {
    mode: 'validation', id: 'si2', evaluate, input: [{}],
    prepareScript: (code, globals) => prepareScript(code, globals, SCRIPTS),
  });
  expect(record.components.find(c => c.nodeId === 's')!.outputSample['out-0']).toEqual([{ result: 'named process: x' }]);
});
