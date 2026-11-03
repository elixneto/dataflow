import {useRef, useState, type PointerEvent, type RefObject} from 'react';

/**
 * Widths (in fr, summing 100) of the columns of a table that the user resizes by dragging the header
 * divider. They are remembered in the browser by `key`.
 */
export function useColumnWidths(key: string, defaults: number[]) {
  const [widths, setWidths] = useState<number[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as number[] | null;
      if (Array.isArray(saved) && saved.length === defaults.length && saved.every(n => typeof n === 'number' && n > 0)) return saved;
    } catch {
      // no storage or a broken value: uses the default
    }
    return defaults;
  });

  function remember(value: number[]) {
    try {
      localStorage.setItem(key, JSON.stringify(value.map(n => Math.round(n * 10) / 10)));
    } catch {
      // no storage: only lasts until reload
    }
  }

  return {widths, setWidths, remember, defaults};
}

const MINIMUM = 10;

/**
 * Divider between column `index` and the next one (sits on the right border of the header cell, which must be
 * `relative`). Dragging moves width from one to the other; double-click goes back to the default.
 */
export function Divider({index, columns, tableRef, fixedWidth = 0}: {
  index: number;
  columns: ReturnType<typeof useColumnWidths>;
  tableRef: RefObject<HTMLElement | null>;
  /** pixels of the columns that do not resize (arrows, buttons, gaps), to convert the drag into fr */
  fixedWidth?: number;
}) {
  const start = useRef<{x: number; widths: number[]} | null>(null);

  function move(e: PointerEvent<HTMLDivElement>) {
    const begin = start.current;
    const table = tableRef.current;
    if (!begin || !table) return;
    const total = begin.widths.reduce((s, n) => s + n, 0);
    const width = Math.max(table.getBoundingClientRect().width - fixedWidth, 1);
    const delta = ((e.clientX - begin.x) / width) * total;
    const pair = begin.widths[index] + begin.widths[index + 1];
    const left = Math.min(Math.max(begin.widths[index] + delta, MINIMUM), pair - MINIMUM);
    columns.setWidths(begin.widths.map((n, i) => (i === index ? left : i === index + 1 ? pair - left : n)));
  }

  function release() {
    if (!start.current) return;
    start.current = null;
    columns.setWidths(current => {
      columns.remember(current);
      return current;
    });
  }

  return (
    <div role="separator" aria-orientation="vertical" aria-label="Resize columns" title="Drag to resize; double-click goes back to the default"
         onPointerDown={e => {
           start.current = {x: e.clientX, widths: columns.widths};
           e.currentTarget.setPointerCapture(e.pointerId);
         }}
         onPointerMove={move} onPointerUp={release} onPointerCancel={release}
         onDoubleClick={() => {
           columns.setWidths(columns.defaults);
           columns.remember(columns.defaults);
         }}
         className="group absolute -right-1.5 top-0 z-10 flex h-full w-3 cursor-col-resize touch-none justify-center">
      <span className="h-full w-px bg-border group-hover:w-0.5 group-hover:bg-primary"/>
    </div>
  );
}
