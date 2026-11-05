import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { followRunChanges, listRuns, toRunSummary, type RunChange } from '../src/data/runs/runs-api';
import { MemoryRouter } from 'react-router';
import { descendants, EMPTY_FILTER, findIn, runTree, statusCounts, type RunSummary } from '../src/data/runs/run-history';
import { duration } from '../src/pages/runs/run-status';
import { RunList } from '../src/pages/runs/run-list';
import { RunOverview } from '../src/pages/runs/run-overview';
import { idSearch } from '../src/pages/runs/runs-page';

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 5, 12, minutes));
const run = (id: string, fields: Partial<RunSummary> = {}): RunSummary => ({
  id,
  status: 'completed',
  trigger: 'manual',
  projectId: 'p1',
  projectName: 'CreateWise',
  flowId: `f-${id}`,
  flowName: `Flow ${id}`,
  queuedAt: at(0),
  ...fields,
});

/** Import (completed) queued two batches: one completed, one still running that queued one that failed */
const history = [
  run('import', { queuedAt: at(10), flowName: 'Import orders' }),
  run('b1', { trigger: 'flow-invoker', parentId: 'import', rootId: 'import', queuedAt: at(11), batchSize: 100, calledBy: 'Enrich' }),
  run('b2', { trigger: 'flow-invoker', parentId: 'import', rootId: 'import', queuedAt: at(12), status: 'running', batchSize: 40, calledBy: 'Enrich' }),
  run('leaf', { trigger: 'flow-invoker', parentId: 'b2', rootId: 'import', queuedAt: at(13), status: 'failed', projectId: 'p1' }),
  run('report', { queuedAt: at(5), trigger: 'schedule', projectId: 'p2', projectName: 'Marketing', flowName: 'Daily report' }),
];

describe('the run history', () => {
  test('each run under the one that queued it: the top runs newest first, the queued ones in the order they were queued', () => {
    const roots = runTree(history);
    expect(roots.map(r => r.id)).toEqual(['import', 'report']);
    expect(roots[0]!.children.map(r => r.id)).toEqual(['b1', 'b2']);
    expect(descendants(roots[0]!).map(r => r.id)).toEqual(['b1', 'b2', 'leaf']);
    expect(statusCounts(descendants(roots[0]!))).toEqual([
      { status: 'running', count: 1 },
      { status: 'completed', count: 1 },
      { status: 'failed', count: 1 },
    ]);
    // a run whose parent is not in the list stands at the top
    expect(runTree([run('orphan', { parentId: 'gone' })]).map(r => r.id)).toEqual(['orphan']);
  });

  test('the list: a top run with a bar of the runs it queued (one segment each) and what to know about them; its error when it failed', () => {
    const roots = runTree([...history, run('sync', { queuedAt: at(1), status: 'failed', flowName: 'Sync partners', error: '401 Unauthorized · partner token expired' })]);
    const html = renderToStaticMarkup(<RunList roots={roots} treeSizes={{ import: 3 }} hasMore onMore={() => {}} selected="import" onSelect={() => {}} now={at(20)} />);
    expect(html).toMatch(/aria-current="true".*Import orders.*CreateWise · Run for real · 10 minutes ago/);
    expect(html).toContain('aria-label="3 queued run(s)"');
    expect(html).toContain('1 failed below');
    expect(html).toContain('401 Unauthorized · partner token expired');
    expect(html).toContain('Showing 3 root runs');
    expect(html).toContain('Load more');
  });

  test('the run on the right: its numbers, a timeline row per run of its tree, and its problems; a run under it says who queued it', () => {
    const root = runTree(history)[0]!;
    const view = (selected: string) =>
      renderToStaticMarkup(
        <MemoryRouter>
          <RunOverview root={root} selected={findIn(root, selected)!} onSelect={() => {}} onStop={async () => ({ ok: true, value: null })} now={at(20)} />
        </MemoryRouter>,
      );
    const top = view('import');
    expect(top).toContain('Fan-out timeline');
    expect(top).toContain('1 still going');
    expect(top).toContain('1 failed below');
    expect(top).toMatch(/Batches<\/dt><dd[^>]*>2 · 1 nested/);
    expect(top.match(/col-span-3 grid/g)).toHaveLength(4);
    expect(top).toMatch(/Problems <span[^>]*>1<\/span>/);
    expect(top).toContain('href="/runs/import"');
    const child = view('b2');
    expect(child).toContain('href="/runs/b2"');
    expect(child).toMatch(/Queued by<\/dt>.*Import orders/);
    expect(child).toContain('Running');
    // Stop: the run itself while it goes on, and the runs it queued that still go on
    expect(child).toMatch(/<\/svg> Stop<\/button>.*<\/svg> Stop 0 below|<\/svg> Stop<\/button>/);
    expect(top).not.toMatch(/<\/svg> Stop<\/button>/);
    expect(top).toContain('Stop 1 below');
  });
  test("a search that is a run id (or its first 8 digits or more) chooses that run; a flow's name does not", () => {
    expect(idSearch(' 7F3C9A12-4b8e-4d21-9c3a-1e2f4a5b6c7d ')).toBe('7f3c9a12-4b8e-4d21-9c3a-1e2f4a5b6c7d');
    expect(idSearch('7f3c9a12')).toBe('7f3c9a12');
    expect(idSearch('7f3c9a12-4b8e')).toBe('7f3c9a12-4b8e');
    expect(idSearch('7f3c')).toBeUndefined();
    expect(idSearch('import orders')).toBeUndefined();
    expect(idSearch('deadbeefcafe')).toBe('deadbeefcafe');
  });

  test('durations read short', () => {
    expect([duration(850), duration(12_000), duration(125_000), duration(3_840_000)]).toEqual(['850 ms', '12 s', '2 min 5 s', '1 h 4 min']);
  });

  test('the api: a run as it comes (dates as text, nothing as null) becomes a RunSummary; the filter goes in the query', async () => {
    const summary = toRunSummary({
      id: 'r1', status: 'running', trigger: 'flow-invoker', projectId: 'p1', projectName: 'CreateWise', flowId: 'f1', flowName: 'Enrich', startedBy: null,
      queuedAt: '2026-11-05T12:00:00.000Z', startedAt: '2026-11-05T12:00:02.000Z', finishedAt: null, durationMs: null, envelopesIn: 40, envelopesOut: null,
      error: null, workerId: 'w', parentId: 'top', rootId: 'top', calledBy: 'Enrich in batches', batchSize: 40,
    });
    expect(summary).toMatchObject({ queuedAt: new Date('2026-11-05T12:00:00.000Z'), startedAt: new Date('2026-11-05T12:00:02.000Z'), batchSize: 40, calledBy: 'Enrich in batches' });
    expect('finishedAt' in summary && summary.finishedAt).toBeFalsy();
    expect(summary.startedBy).toBeUndefined();

    const asked: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      asked.push(url);
      return new Response(JSON.stringify({ runs: [], treeSizes: {}, next: null }), { status: 200 });
    }) as typeof fetch;
    try {
      await listRuns({ ...EMPTY_FILTER, status: 'problems', trigger: 'webhook', search: ' 7f3c ' }, '2026-11-05T12:00:00.000Z|abc', 10);
      await listRuns(EMPTY_FILTER);
      await listRuns({ ...EMPTY_FILTER, period: '7d' });
    } finally {
      globalThis.fetch = real;
    }
    expect(asked).toEqual(['/api/runs?limit=10&status=problems&trigger=webhook&q=7f3c&before=2026-11-05T12%3A00%3A00.000Z%7Cabc', '/api/runs?limit=20', '/api/runs?limit=20&period=7d']);
  });

  test("the live stream: each change as it comes (also split across chunks), the open once it is ready", async () => {
    const chunks = ['event: ready\ndata: {}\n\n', 'event: change\ndata: {"id":"a","rootId":"a","status":"queued"}\n', '\nevent: ping\ndata: {}\n\nevent: change\ndata: {"id":"b","rootId":"a","status":"failed"}\n\n'];
    const real = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(new ReadableStream({ start(controller) { for (const c of chunks) controller.enqueue(new TextEncoder().encode(c)); controller.close(); } }), { status: 200 })) as unknown as typeof fetch;
    const changes: RunChange[] = [];
    let opened = 0;
    try {
      await followRunChanges(change => changes.push(change), new AbortController().signal, () => (opened += 1));
    } finally {
      globalThis.fetch = real;
    }
    expect(opened).toBe(1);
    expect(changes).toEqual([{ id: 'a', rootId: 'a', status: 'queued' }, { id: 'b', rootId: 'a', status: 'failed' }]);
  });

  test('a stream that goes silent (a proxy keeping a connection the server closed) is given up, so it is opened again', async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('event: ready\ndata: {}\n\n'));
            // nothing more, and never closed: only the abort ends it
            init.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
          },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const t0 = Date.now();
    try {
      await followRunChanges(() => {}, new AbortController().signal, undefined, 60);
    } finally {
      globalThis.fetch = real;
    }
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});