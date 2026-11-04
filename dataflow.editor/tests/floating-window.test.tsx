import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { FloatingWindow } from '../src/editor/floating-window';

const render = (minimized: boolean) =>
  renderToStaticMarkup(
    <FloatingWindow
      title="Prices"
      icon={<span />}
      position={{ x: 10, y: 20 }}
      initialSize={{ w: 760, h: null }}
      z={1}
      active
      onMove={() => {}}
      onFocus={() => {}}
      onClose={() => {}}
      onMinimize={() => {}}
      minimized={minimized}
      label="Configuration of Prices"
    >
      <p>draft</p>
    </FloatingWindow>,
  );

describe('a minimized window', () => {
  test('has a Minimize button next to the X', () => {
    expect(render(false)).toContain('aria-label="Minimize window"');
  });

  test('is hidden but kept (its content and size stay, so unsaved edits and a resized size come back)', () => {
    const html = render(true);
    expect(html).toMatch(/<section [^>]*hidden=""/);
    expect(html).toContain('<p>draft</p>');
    expect(html).toContain('width:760px');
    expect(render(false)).not.toMatch(/<section [^>]*hidden=""/);
  });
});
