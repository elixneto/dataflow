import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import type { FlowCall } from '@dataflow/core';
import { FlowCallsView } from '../src/pages/flow-editor/flow-calls';
import { withOwnCalls } from '../src/editor/project-calls';

const call = (from: string, to: string, nodeLabel = `Calls ${to}`): FlowCall => ({ from, to, nodeId: `${from}-${to}`, nodeLabel });
const data = {
  flows: [
    { id: 'a', name: 'Flow 1', folder: '', available: true },
    { id: 'b', name: 'Flow 2', folder: 'Imports', available: true },
    { id: 'c', name: 'Flow 3', folder: '', available: false },
    { id: 'd', name: 'Caller', folder: '', available: true },
  ],
  calls: [call('a', 'b'), call('b', 'a'), call('a', 'c'), call('d', 'a', 'Run Flow 1'), call('a', 'gone')],
  cycles: [['a', 'b', 'a']],
  scripts: [],
  scriptUses: [],
  scriptImports: [],
};
const view = (calls: FlowCall[]) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <FlowCallsView projectId="p" flowId="a" data={data} calls={calls} />
    </MemoryRouter>,
  );

describe("a flow's calls, in the top bar", () => {
  test('the tree down the chain, a cycle closed where it comes back, an archived or removed flow marked; the callers', () => {
    const html = view(data.calls);
    expect(html).toContain('href="/projects/p/flows/b"');
    expect(html).toContain('Imports · via Calls b');
    // Flow 2 calls Flow 1 back: the row under it says so and is not followed again
    expect(html).toContain('Circular: back to Flow 1; each call fails');
    expect(html).toContain('Archived: each call fails');
    expect(html).toContain('Removed: each call fails');
    expect(html).toMatch(/aria-label="Called by".*Caller.*via Run Flow 1/);
  });

  test("this flow's own calls as the canvas has them replace the saved ones", () => {
    const own = withOwnCalls(data.calls, 'a', [call('a', 'b')]);
    expect(own.filter(c => c.from === 'a').map(c => c.to)).toEqual(['b']);
    expect(view(own)).not.toContain('Archived: each call fails');
    expect(withOwnCalls(data.calls, 'a', null)).toBe(data.calls);
  });
});
