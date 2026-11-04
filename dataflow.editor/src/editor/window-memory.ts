import type { WindowPosition, WindowSize } from './floating-window';

/*
 * Where each component's window was and its size, as in the PoC: per flow and component, kept in this browser tab
 * (sessionStorage), outside the flow and Ctrl+Z. Reopened, the window comes back where it was, with the size it had.
 */

export type RememberedWindow = { position?: WindowPosition; size?: WindowSize };

const key = (flowId: string, nodeId: string) => `dataflow.window:${flowId}:${nodeId}`;

export function readWindow(flowId: string, nodeId: string): RememberedWindow {
  try {
    return JSON.parse(sessionStorage.getItem(key(flowId, nodeId)) ?? '{}') as RememberedWindow;
  } catch {
    return {};
  }
}

export function rememberWindow(flowId: string, nodeId: string, update: RememberedWindow) {
  try {
    sessionStorage.setItem(key(flowId, nodeId), JSON.stringify({ ...readWindow(flowId, nodeId), ...update }));
  } catch {
    // no storage: it opens in the default place next time
  }
}
