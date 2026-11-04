import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { JsonTree } from '../src/editor/run/json-tree';
import { expressionPath, summaryOf } from '../src/editor/run/json-paths';

const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#x27;/g, "'");

describe("the run panel's JSON tree", () => {
  test('opens two levels (the envelopes and their keys); deeper objects and arrays closed with what they hold', () => {
    const envelopes = [{ id: 1, ok: true, note: null, response: { status: 200, headers: { a: '1', b: '2' } }, tags: ['x', 'y', 'z'] }];
    const html = renderToStaticMarkup(<JsonTree value={envelopes} memoryKey="t1" />);
    const shown = text(html);
    expect(shown).toContain('Expand all');
    expect(shown).toContain('Collapse all');
    expect(shown).toContain('"id": 1,');
    expect(shown).toContain('"ok": true,');
    expect(shown).toContain('"note": null,');
    expect(shown).toContain('"response": {…} 2 keys,');
    expect(shown).toContain('"tags": […] 3 items');
    // values colored by type
    expect(html).toMatch(/text-amber-700[^"]*">1</);
    expect(html).toMatch(/text-violet-700[^"]*">true</);
    // the open ones say so, for the keyboard and screen readers
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-expanded="false"');
  });

  test('a long array shows 100 items at a time', () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ i }));
    const shown = text(renderToStaticMarkup(<JsonTree value={many} memoryKey="t2" />));
    expect(shown).toContain('Show 100 more of 150');
    expect(shown.match(/"i": /g)).toHaveLength(100);
  });

  test('empty objects and arrays are written as they are, without a caret', () => {
    const html = renderToStaticMarkup(<JsonTree value={[{ a: {}, b: [] }]} memoryKey="t3" />);
    expect(text(html)).toContain('"a": {},');
    expect(text(html)).toContain('"b": []');
  });

  test('summaries and paths as expressions (the envelope index left out)', () => {
    expect(summaryOf({ a: 1 })).toBe('{…} 1 key');
    expect(summaryOf([1, 2])).toBe('[…] 2 items');
    expect(expressionPath([0, 'response', 'headers', 'set-cookie'])).toBe('$response.headers["set-cookie"]');
    expect(expressionPath([3, 'items', 0, 'id'])).toBe('$items[0].id');
    expect(expressionPath([0])).toBe('$');
  });
});
