import { describe, expect, test } from 'bun:test';
import { EDIT_WINDOW_MS, UndoStack } from '../src/editor/history';

describe('undo / redo', () => {
  test('undo goes back step by step, redo forward; a new change drops what was undone', () => {
    const stack = new UndoStack<string>();
    stack.record('a');
    stack.record('b');

    expect(stack.undo('c')).toBe('b');
    expect(stack.undo('b')).toBe('a');
    expect(stack.undo('a')).toBeUndefined();
    expect(stack.redo('a')).toBe('b');
    expect(stack.canRedo).toBe(true);

    stack.record('b');
    expect(stack.canRedo).toBe(false);
  });

  test('typing in the same field is one step; another field or a pause is a new one', () => {
    const stack = new UndoStack<string>();
    stack.recordEdit('', 'g:title', 0);
    stack.recordEdit('a', 'g:title', 300);
    stack.recordEdit('ab', 'g:title', 600);
    stack.recordEdit('abc', 'g:color', 700);
    stack.recordEdit('abc', 'g:color', 700 + EDIT_WINDOW_MS + 1);

    expect(stack.undo('now')).toBe('abc');
    expect(stack.undo('abc')).toBe('abc');
    expect(stack.undo('abc')).toBe('');
    expect(stack.canUndo).toBe(false);
  });

  test('keeps at most the limit', () => {
    const stack = new UndoStack<number>(3);
    [1, 2, 3, 4, 5].forEach(n => stack.record(n));
    expect([stack.undo(6), stack.undo(5), stack.undo(4), stack.undo(3)]).toEqual([5, 4, 3, undefined]);
  });
});
