import { afterEach, describe, expect, test } from 'bun:test';
import type { Flow, Folder, ProjectContents } from '../src/data/flows/flow';
import * as api from '../src/data/flows/flows-api';
import { archivedItems } from '../src/data/flows/project-tree';
import { formatDate, formatDateTime, LOCALE } from '../src/lib/format';
import { relativeTime } from '../src/lib/relative-time';

const at = (iso: string) => new Date(iso);

const folder = (id: string, parentId: string | null, archivedAt: Date | null = null): Folder => ({
  id,
  projectId: 'p',
  parentId,
  name: id,
  createdAt: at('2026-10-01T00:00:00Z'),
  archivedAt,
});

const flow = (id: string, folderId: string | null, archivedAt: Date | null = null): Flow => ({
  id,
  projectId: 'p',
  folderId,
  name: id,
  createdAt: at('2026-10-01T00:00:00Z'),
  updatedAt: at('2026-10-02T00:00:00Z'),
  updatedBy: 'ana',
  archivedAt,
});

describe('archived list', () => {
  test('lists what was archived on its own or at the top of a folder, not what went with the folder', () => {
    const together = at('2026-11-02T10:00:00Z');
    const before = at('2026-11-01T10:00:00Z');
    const contents: ProjectContents = {
      folders: [folder('Imports', null, together), folder('Daily', 'Imports', together), folder('Reports', null)],
      flows: [flow('Orders', 'Daily', together), flow('Old', 'Daily', before), flow('Report', 'Reports', at('2026-11-03T10:00:00Z'))],
    };

    expect(archivedItems(contents).map(a => a.item.id)).toEqual(['Report', 'Imports', 'Old']);
  });
});

describe('flows api', () => {
  const realFetch = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];

  const answer = (status: number, body?: unknown) => {
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(body === undefined ? null : JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
  };

  afterEach(() => {
    globalThis.fetch = realFetch;
    calls.length = 0;
  });

  const flowDto = {
    id: 'f',
    projectId: 'p',
    folderId: 'd',
    name: 'Orders',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
    updatedBy: 'ana',
    archivedAt: null,
  };
  const folderDto = { id: 'd', projectId: 'p', parentId: null, name: 'Daily', createdAt: '2026-10-01T00:00:00.000Z', archivedAt: '2026-11-01T00:00:00.000Z' };

  test('contents come as Date values', async () => {
    answer(200, { folders: [folderDto], flows: [flowDto] });

    const result = await api.getProjectContents('p');

    expect(calls[0]!.url).toBe('/api/projects/p/contents');
    expect(result).toEqual({
      ok: true,
      value: {
        folders: [{ ...folderDto, createdAt: at(folderDto.createdAt), archivedAt: at(folderDto.archivedAt) }],
        flows: [{ ...flowDto, createdAt: at(flowDto.createdAt), updatedAt: at(flowDto.updatedAt) }],
      },
    });
  });

  test('each change calls its route with its body', async () => {
    answer(200, flowDto);
    await api.createFolder('p', 'd', 'Sub');
    await api.renameFolder('d', 'Days');
    await api.moveFolder('d', null);
    await api.archiveFolder('d');
    await api.restoreFolder('d');
    await api.createFlow('p', { name: 'New', folderId: null });
    await api.renameFlow('f', 'Renamed');
    await api.moveFlow('f', 'd');
    await api.archiveFlow('f');
    await api.restoreFlow('f');

    expect(calls.map(c => `${c.init.method} ${c.url} ${c.init.body ?? ''}`.trim())).toEqual([
      'POST /api/projects/p/folders {"name":"Sub","parentId":"d"}',
      'PATCH /api/folders/d {"name":"Days"}',
      'POST /api/folders/d/move {"parentId":null}',
      'POST /api/folders/d/archive',
      'POST /api/folders/d/restore',
      'POST /api/projects/p/flows {"name":"New","folderId":null}',
      'PATCH /api/flows/f {"name":"Renamed"}',
      'POST /api/flows/f/move {"folderId":"d"}',
      'POST /api/flows/f/archive',
      'POST /api/flows/f/restore',
    ]);
  });

  test('a conflict comes back with the field error for the dialog', async () => {
    const error = { code: 'conflict', message: 'A flow named "Orders" is already there.', fields: { name: 'Already in use' } };
    answer(409, { error });

    expect(await api.moveFlow('f', 'd')).toEqual({ ok: false, error });
  });
});

describe('dates', () => {
  const now = new Date('2026-11-03T12:00:00Z');
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);

  test('words are always English', () => {
    expect(LOCALE).toBe('en-US');
    expect(relativeTime(ago(10), now)).toBe('now');
    expect(relativeTime(ago(5 * 60), now)).toBe('5 minutes ago');
    expect(relativeTime(ago(24 * 60 * 60), now)).toBe('yesterday');
    expect(relativeTime(ago(7 * 24 * 60 * 60), now)).toBe('last week');
  });

  test('absolute dates are numeric, in the order of the region', () => {
    const date = new Date(2026, 10, 3, 18, 5);

    expect(formatDate(date, 'pt-BR')).toBe('03/11/2026');
    expect(formatDate(date, 'en-US')).toBe('11/03/2026');
    expect(formatDateTime(date, 'pt-BR')).toMatch(/^03\/11\/2026,? 18:05$/);
    expect(formatDateTime(date, 'pt-BR')).not.toMatch(/[a-z]/i);
  });
});
