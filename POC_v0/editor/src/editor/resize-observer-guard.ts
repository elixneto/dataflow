import {useEffect} from 'react';

const BENIGN_MESSAGE = 'ResizeObserver loop';

type PatchedResizeObserver = typeof ResizeObserver & {__rafPatched?: boolean};

// React Flow measures each node with a ResizeObserver. When a node grows during the measurement (e.g. stretching a comment),
// the browser warns "ResizeObserver loop completed". Deferring the callback to the next frame breaks that cycle.
// Runs when the module loads, before React Flow creates its observers.
function applyPatch() {
  if (typeof window === 'undefined') return;
  const Native = window.ResizeObserver as PatchedResizeObserver | undefined;
  if (!Native || Native.__rafPatched) return;

  class RafResizeObserver extends Native {
    constructor(callback: ResizeObserverCallback) {
      let frame = 0;
      super((entries, observer) => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => callback(entries, observer));
      });
    }
  }
  ;(RafResizeObserver as PatchedResizeObserver).__rafPatched = true;
  window.ResizeObserver = RafResizeObserver;
}

applyPatch();

export function ResizeObserverGuard() {
  useEffect(() => {
    function onError(event: ErrorEvent) {
      if (event.message?.includes(BENIGN_MESSAGE)) {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    }
    window.addEventListener('error', onError, {capture: true});
    return () => window.removeEventListener('error', onError, {capture: true});
  }, []);
  return null;
}
