import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Edge, Node } from '@xyflow/react';
import type { FlowFile } from '@dataflow/core';
import { getDraft, saveDraft } from '@/data/flows/flows-api';
import { useServerConnection } from '@/lib/server-connection';
import { canvasToFlowFile, flowFileToCanvas } from './flow-file';

/*
 * The flow's draft on the server: opened with the editor, saved by itself a moment after each change (as in the PoC),
 * right away with Ctrl+S, and when the page closes or is hidden. Only what is in the flow file counts as a change
 * (selecting, zooming or panning saves nothing). A save that another one beat (409) stops the saves until the flow is
 * reloaded; one the server could not take is tried again when the server is back.
 */

/** how long after the last change the draft is saved */
export const AUTOSAVE_DELAY_MS = 1_000;

export type SaveState =
  | { status: 'loading' }
  | { status: 'saved' }
  | { status: 'pending' }
  | { status: 'saving' }
  | { status: 'error'; message: string }
  | { status: 'conflict' };

/** what is compared to know whether the canvas changed since the last save */
export const draftFingerprint = (file: FlowFile) => JSON.stringify({ nodes: file.nodes, edges: file.edges, groups: file.groups ?? [] });

/** the draft's state and what can be done with it (the top bar shows it) */
export type DraftSave = { state: SaveState; saveNow: () => void; reload: () => void };

export function useFlowDraft(flowId: string, canvas: { nodes: Node[]; edges: Edge[] }, load: (canvas: ReturnType<typeof flowFileToCanvas>) => void): DraftSave {
  const [state, setState] = useState<SaveState>({ status: 'loading' });
  const online = useServerConnection().state === 'online';
  // what the server has: its revision, the flow's name, and what was saved (to tell a real change)
  const server = useRef<{ revision: number; name: string; saved: string } | null>(null);
  const saving = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(canvas);
  const loadRef = useRef(load);
  // the save after a save (the canvas changed while it was saving)
  const again = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    latest.current = canvas;
    loadRef.current = load;
  });

  const fileNow = useCallback(() => canvasToFlowFile({ id: flowId, name: server.current?.name ?? '' }, latest.current.nodes, latest.current.edges), [flowId]);

  const open = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setState({ status: 'loading' });
    }

    server.current = null;
    const result = await getDraft(flowId);
    if (!result.ok) {
      setState({ status: 'error', message: result.error.message });
      return;
    }

    const { flow, revision } = result.value;
    server.current = { revision, name: flow.name, saved: draftFingerprint(flow) };
    loadRef.current(flowFileToCanvas(flow));
    setState({ status: 'saved' });
  }, [flowId]);

  const save = useCallback(
    async (keepalive = false) => {
      clearTimeout(timer.current);
      const at = server.current;
      if (!at || saving.current) {
        return;
      }

      const file = fileNow();
      const print = draftFingerprint(file);
      if (print === at.saved) {
        setState({ status: 'saved' });
        return;
      }

      saving.current = true;
      setState({ status: 'saving' });
      const result = await saveDraft(flowId, at.revision, file, keepalive);
      saving.current = false;
      if (result.ok) {
        server.current = { ...at, revision: result.value.revision, saved: print };
        // changed while it was saving: one more save
        if (draftFingerprint(fileNow()) !== print) {
          setState({ status: 'pending' });
          timer.current = setTimeout(() => again.current(), AUTOSAVE_DELAY_MS);
        } else {
          setState({ status: 'saved' });
        }
      } else if (result.error.code === 'conflict') {
        server.current = null;
        setState({ status: 'conflict' });
      } else {
        setState({ status: 'error', message: result.error.message });
      }
    },
    [flowId, fileNow],
  );
  useEffect(() => {
    again.current = () => void save();
  }, [save]);

  // opens the draft when the editor opens a flow (a fetch: its answer sets the state)
  const openRef = useRef(open);
  useLayoutEffect(() => {
    openRef.current = open;
  });
  useEffect(() => {
    void openRef.current(false);
    return () => clearTimeout(timer.current);
  }, [flowId]);

  // a change: saved a moment later (each new change waits again)
  useEffect(() => {
    const at = server.current;
    if (!at || draftFingerprint(fileNow()) === at.saved) {
      return;
    }

    setState(current => (current.status === 'saving' ? current : { status: 'pending' }));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
  }, [canvas.nodes, canvas.edges, fileNow, save]);

  // the server is back: what failed (or never opened) goes now
  useEffect(() => {
    if (!online) {
      return;
    }

    if (state.status === 'error') {
      void (server.current ? save() : open());
    }
  }, [online, state.status, save, open]);

  // the page closes or is hidden: what is pending goes now (and may still reach the server after the page is gone)
  useEffect(() => {
    const flush = () => {
      if (server.current && draftFingerprint(fileNow()) !== server.current.saved) {
        void save(true);
      }
    };
    const hidden = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [fileNow, save]);

  // the same object while nothing changes (the page keeps it in its state)
  const saveNow = useCallback(() => void save(), [save]);
  const reload = useCallback(() => void open(), [open]);
  return useMemo(() => ({ state, saveNow, reload }), [state, saveNow, reload]);
}
