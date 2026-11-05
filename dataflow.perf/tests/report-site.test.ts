import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allResults, buildReport, serveReport } from '#perf/report-site';

const dir = mkdtempSync(join(tmpdir(), 'perf-report-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('report page', () => {
  test('builds the static page: the HTML, the style and the app as one classic script (Chrome refuses modules from file://)', async () => {
    const page = await buildReport(join(dir, 'site'));
    const html = readFileSync(page, 'utf8');
    expect(html).toContain('<script src="app.js" defer>');
    expect(html).not.toContain('type="module"');
    expect(html).not.toMatch(/https?:\/\//);
    const app = readFileSync(join(dir, 'site', 'app.js'), 'utf8');
    expect(app).toContain('results.jsonl');
    expect(app).not.toMatch(/^\s*(import|export) /m);
  });

  test('joins the result files of every machine', () => {
    const results = join(dir, 'results');
    rmSync(results, { recursive: true, force: true });
    mkdirSync(results, { recursive: true });
    writeFileSync(join(results, 'a.jsonl'), '{"x":1}\n');
    writeFileSync(join(results, 'b.jsonl'), '{"x":2}\n\n');
    writeFileSync(join(results, 'notes.txt'), 'ignored');
    expect(allResults(results)).toBe('{"x":1}\n{"x":2}');
    expect(allResults(join(dir, 'missing'))).toBe('');
  });

  test('serves the page and the results on 127.0.0.1, nothing else', async () => {
    const site = await serveReport(0, join(dir, 'served'));
    try {
      expect((await fetch(site.url)).headers.get('content-type')).toContain('text/html');
      expect((await fetch(`${site.url}app.js`)).headers.get('content-type')).toContain('javascript');
      expect((await fetch(`${site.url}results.jsonl`)).status).toBe(200);
      expect((await fetch(`${site.url}../package.json`)).status).toBe(404);
      expect((await fetch(`${site.url}secret.txt`)).status).toBe(404);
      expect(site.url.startsWith('http://127.0.0.1:')).toBe(true);
    } finally {
      site.stop();
    }
  });
});
