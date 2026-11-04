import type { RunProgress, RunRecord } from '@dataflow/core';
import { apiHeaders } from '@/lib/api';
import type { RunUsage } from './flows-api';

/** the "event: x" + "data: {...}" blocks of a server-sent events stream, as they come (`rest`: an unfinished block) */
export function parseEvents(text: string): { events: { type: string; data: string }[]; rest: string } {
  const blocks = text.split('\n\n');
  const rest = blocks.pop() ?? '';
  const events = blocks.flatMap(block => {
    const type = /^event: ?(.*)$/m.exec(block)?.[1];
    const data = block
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n');
    return type ? [{ type, data }] : [];
  });
  return { events, rest };
}

/**
 * Follows a run as it goes (GET /runs/:id/events, SSE, read with fetch so it carries the api's headers, which an
 * EventSource cannot): each "progress" (the run so far) goes to `onProgress`; resolves at "done" with the record and
 * what its worker used ("usage", just before), or null when the stream fails (then the caller asks GET /runs/:id).
 */
export async function followRun(id: string, onProgress: (progress: RunProgress) => void): Promise<{ record: RunRecord; usage: RunUsage | null } | null> {
  try {
    const response = await fetch(`/api/runs/${id}/events`, { headers: { ...apiHeaders(), accept: 'text/event-stream' } });
    if (!response.ok || !response.body) {
      return null;
    }

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    let usage: RunUsage | null = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        return null;
      }

      const parsed = parseEvents(buffer + value.replace(/\r\n/g, '\n'));
      buffer = parsed.rest;
      for (const event of parsed.events) {
        if (event.type === 'progress') {
          onProgress(JSON.parse(event.data) as RunProgress);
        } else if (event.type === 'usage') {
          usage = JSON.parse(event.data) as RunUsage;
        } else if (event.type === 'done') {
          void reader.cancel();
          return { record: JSON.parse(event.data) as RunRecord, usage };
        }
      }
    }
  } catch {
    return null;
  }
}
