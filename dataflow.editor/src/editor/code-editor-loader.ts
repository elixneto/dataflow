/**
 * The code editor (Monaco) loads on demand, so the canvas does not carry it; the flow page asks for it in the
 * background as soon as it opens, so a window with code shows Monaco at once.
 */
export const loadCodeEditor = () => import('./code-editor');

/** loads Monaco when the browser is idle (once: the import is cached) */
export function preloadCodeEditor() {
  const load = () => void loadCodeEditor();
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(load, { timeout: 3000 });
  } else {
    setTimeout(load, 1000);
  }
}
