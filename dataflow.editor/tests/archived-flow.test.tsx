import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { stateAfterRefusedSave, type DraftSave, type SaveState } from '../src/editor/flow-save';
import { editing } from '../src/editor/read-only';
import { SaveStatus } from '../src/pages/flow-editor/save-status';

const draft = (state: SaveState): DraftSave => ({ state, saveNow: () => {}, reload: () => {}, resume: async () => {}, flush: async () => 'saved' });
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('a save the server refuses', () => {
  test('not found (the flow was archived or removed): gone, nothing to retry', () => {
    expect(stateAfterRefusedSave({ code: 'not-found', message: 'Flow not found.' })).toEqual({ status: 'gone' });
  });

  test('a conflict asks to reload; anything else is an error to retry', () => {
    expect(stateAfterRefusedSave({ code: 'conflict', message: 'changed elsewhere' })).toEqual({ status: 'conflict' });
    expect(stateAfterRefusedSave({ code: 'unavailable', message: 'Server unavailable' })).toEqual({ status: 'error', message: 'Server unavailable' });
  });

  test('the top bar: gone says so and offers no Retry; an error keeps Retry', () => {
    const gone = renderToStaticMarkup(<SaveStatus save={draft({ status: 'gone' })} />);
    expect(text(gone)).toBe('This flow was archived or removed');
    expect(gone).not.toContain('Retry');
    expect(text(renderToStaticMarkup(<SaveStatus save={draft({ status: 'error', message: 'x' })} />))).toContain('Retry');
  });
});

describe('an archived flow', () => {
  test('the top bar shows Archived and Restore, not the save state', () => {
    const html = renderToStaticMarkup(<SaveStatus save={draft({ status: 'read-only' })} archived={{ onRestore: () => {}, restoring: false }} />);
    expect(text(html)).toBe('Archived (read-only) Restore');
    expect(html).not.toMatch(/\sdisabled=""/);
    // while restoring the button waits; a failed restore says why
    expect(renderToStaticMarkup(<SaveStatus save={null} archived={{ onRestore: () => {}, restoring: true }} />)).toMatch(/\sdisabled=""/);
    expect(text(renderToStaticMarkup(<SaveStatus save={null} archived={{ onRestore: () => {}, restoring: false, error: 'Project not found.' }} />))).toContain('Archived: Project not found.');
  });

  test('read-only shows nothing of the save state by itself', () => {
    expect(renderToStaticMarkup(<SaveStatus save={draft({ status: 'read-only' })} />)).toBe('');
  });

  test('the canvas lets nothing change: no drag, connection, selection or delete', () => {
    expect(editing(true)).toEqual({ nodesDraggable: false, nodesConnectable: false, edgesReconnectable: false, elementsSelectable: false, deleteKeyCode: null, selectionOnDrag: false });
    expect(editing(false).deleteKeyCode).toEqual(['Delete', 'Backspace']);
    expect(editing(false).nodesDraggable).toBe(true);
  });
});
