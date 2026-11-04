import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ServerConnection } from '../src/lib/server-connection';
import { FlowActionsView } from '../src/pages/flow-editor/flow-actions';

/** each button's label and whether it is disabled */
const buttons = (connection: ServerConnection) => {
  const html = renderToStaticMarkup(<FlowActionsView connection={connection} onDownload={() => {}} onRun={() => {}} />);
  return [...html.matchAll(/<button[^>]*>.*?<\/button>/g)].map(([b]) => ({
    name: b.match(/aria-label="([^"]+)"/)?.[1] ?? b.replace(/<[^>]+>/g, '').trim(),
    disabled: /\sdisabled=""/.test(b),
    title: b.match(/title="([^"]+)"/)?.[1],
  }));
};

describe('the flow actions and the server', () => {
  test('online: everything can be used but Upload (soon)', () => {
    expect(buttons({ state: 'online', environment: 'DEV' }).map(b => [b.name, b.disabled])).toEqual([
      ['Download', false],
      ['Upload', true],
      ['Run for real', false],
      ['Run', false],
    ]);
  });

  test('disconnected or still checking: all four are disabled ("Server disconnected")', () => {
    for (const connection of [{ state: 'offline' }, { state: 'checking' }] as const) {
      const shown = buttons(connection);
      expect(shown.map(b => [b.name, b.disabled])).toEqual([
        ['Download', true],
        ['Upload', true],
        ['Run for real', true],
        ['Run', true],
      ]);
      expect(shown.every(b => b.title === 'Server disconnected')).toBe(true);
    }
  });
});
