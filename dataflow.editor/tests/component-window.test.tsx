import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComponentWindow } from '../src/editor/component-window';
import type { ComponentData } from '../src/editor/component-node';

const render = (data: ComponentData) =>
  renderToStaticMarkup(<ComponentWindow id="n" data={data} onSave={() => {}} onCancel={() => {}} onRemove={() => {}} registerClose={() => {}} />);

describe("a component's window: Override, as in the PoC", () => {
  test('a component that offers it shows the checkbox, off by default and on when the node has it', () => {
    const off = render({ type: 'http-request', config: {} });
    expect(off).toContain('Override');
    expect(off).toMatch(/<input id="n-override" type="checkbox" class="[^"]*"\/>/);
    expect(render({ type: 'mapper', config: {}, override: true })).toMatch(/<input id="n-override" type="checkbox" class="[^"]*" checked=""\/>/);
  });

  test('a component that does not offer it has no checkbox', () => {
    expect(render({ type: 'filter', config: {} })).not.toContain('Override');
  });
});

test('the Last run tab is there to open (no longer "Soon")', () => {
  const html = render({ type: 'filter', config: {} });
  expect(html).toMatch(/role="tab" aria-selected="false"[^>]*>Last run<\/button>/);
  expect(html).not.toContain('title="Soon"');
});
