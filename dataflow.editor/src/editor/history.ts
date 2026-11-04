import { createContext, useContext } from 'react';

/*
 * Ctrl+Z / Ctrl+Y on the canvas, as in the PoC: before each change the canvas (nodes and edges) is saved; undo goes
 * back to the last saved one, redo forward. Consecutive edits of the same field (typing a group's title) are one step.
 */

/** at most this many steps back */
export const HISTORY_LIMIT = 100;
/** edits of the same field within this time are one step */
export const EDIT_WINDOW_MS = 1000;

/**
 * The steps, without React: `record` saves the state before a change, `undo` / `redo` take the current state and
 * give the one to show (or undefined when there is none).
 */
export class UndoStack<T> {
  private past: T[] = [];
  private future: T[] = [];
  private lastEdit: { key: string; at: number } | null = null;

  constructor(private readonly limit = HISTORY_LIMIT) {}

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  record(current: T) {
    this.past = [...this.past.slice(-(this.limit - 1)), current];
    this.future = [];
    this.lastEdit = null;
  }

  /** like record, but a second edit of the same `key` soon after is part of the same step */
  recordEdit(current: T, key: string, now = Date.now()) {
    const previous = this.lastEdit;
    if (previous && previous.key === key && now - previous.at < EDIT_WINDOW_MS) {
      this.lastEdit = { key, at: now };
      return;
    }

    this.record(current);
    this.lastEdit = { key, at: now };
  }

  undo(current: T): T | undefined {
    const previous = this.past.at(-1);
    if (previous === undefined) {
      return undefined;
    }

    this.past = this.past.slice(0, -1);
    this.future = [...this.future, current];
    this.lastEdit = null;
    return previous;
  }

  redo(current: T): T | undefined {
    const next = this.future.at(-1);
    if (next === undefined) {
      return undefined;
    }

    this.future = this.future.slice(0, -1);
    this.past = [...this.past, current];
    this.lastEdit = null;
    return next;
  }
}

/** what the nodes use to save the canvas before they change it (group title and color, disable, pin) */
export type History = { record: () => void; recordEdit: (key: string) => void };

export const HistoryContext = createContext<History>({ record: () => {}, recordEdit: () => {} });

export const useHistory = () => useContext(HistoryContext);

/** typing in a field: Ctrl+Z there undoes the text, not the canvas */
export const isEditableField = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
