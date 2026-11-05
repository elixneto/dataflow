/* An archived flow on the canvas (flow-canvas.tsx): shown to read, pan and zoom; nothing in it changes. */
/** what React Flow lets the user change: everything, or (read-only) nothing: no drag, no connection, no delete, no selection */
export function editing(readOnly: boolean) {
  return readOnly
    ? { nodesDraggable: false, nodesConnectable: false, edgesReconnectable: false, elementsSelectable: false, deleteKeyCode: null, selectionOnDrag: false }
    : { nodesDraggable: true, nodesConnectable: true, edgesReconnectable: true, elementsSelectable: true, deleteKeyCode: ['Delete', 'Backspace'], selectionOnDrag: true };
}
