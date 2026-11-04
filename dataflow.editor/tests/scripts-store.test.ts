import { afterAll, beforeAll, expect, test } from 'bun:test';
import {
  createScriptPath,
  flushScripts,
  loadScriptContent,
  newPathIssue,
  projectScripts,
  reloadScripts,
  saveScript,
} from '../src/data/scripts/scripts-store';

/** a fake api: the scripts of one project, as the server keeps them */
const server = {
  scripts: new Map<string, { content: string; revision: number }>([['upload/types', { content: 'export interface IItem {}', revision: 0 }]]),
  requests: [] as string[],
};
const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const { pathname, searchParams } = new URL(url, 'http://test');
    const method = init?.method ?? 'GET';
    server.requests.push(`${method} ${pathname}`);
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (pathname.endsWith('/scripts') && method === 'GET') {
      return json({ scripts: [...server.scripts.keys()].map(path => ({ path, exports: [{ name: 'IItem', typeOnly: true }] })), folders: ['upload'] });
    }
    if (pathname.endsWith('/scripts/content') && method === 'GET') {
      const script = server.scripts.get(searchParams.get('path') ?? '');
      return script ? json({ path: searchParams.get('path'), ...script }) : json({ error: { code: 'not-found', message: 'Script not found.' } }, 404);
    }
    if (pathname.endsWith('/scripts/content') && method === 'PUT') {
      const script = server.scripts.get(body.path)!;
      if (script.revision !== body.revision) return json({ error: { code: 'conflict', message: 'This script was changed elsewhere.' } }, 409);
      server.scripts.set(body.path, { content: body.content, revision: script.revision + 1 });
      return json({ revision: script.revision + 1 });
    }
    if (pathname.endsWith('/scripts') && method === 'POST') {
      server.scripts.set(body.path, { content: 'export const example = 1;', revision: 0 });
      return json({ path: body.path, revision: 0 }, 201);
    }
    return json({ error: { code: 'not-found', message: 'Nope.' } }, 404);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

test("the list comes without code; a script's code loads when asked, once", async () => {
  await reloadScripts('p1');
  expect(projectScripts('p1')).toMatchObject({ status: 'ready', scripts: [{ path: 'upload/types', exports: [{ name: 'IItem', typeOnly: true }] }], folders: ['upload'], contents: {} });
  await loadScriptContent('p1', 'upload/types');
  await loadScriptContent('p1', 'upload/types');
  expect(projectScripts('p1').contents['upload/types']).toEqual({ code: 'export interface IItem {}', revision: 0 });
  expect(server.requests.filter(r => r === 'GET /api/projects/p1/scripts/content')).toHaveLength(1);
});

test('typing saves with the revision read (at Ctrl+S here); what it exports follows; a save from elsewhere is a conflict', async () => {
  saveScript('p1', 'upload/types', 'export function shape() {}');
  expect(projectScripts('p1').save).toBe('unsaved');
  await flushScripts('p1');
  expect(projectScripts('p1')).toMatchObject({ save: 'saved', contents: { 'upload/types': { code: 'export function shape() {}', revision: 1 } } });
  expect(projectScripts('p1').scripts[0]!.exports).toEqual([{ name: 'shape', typeOnly: false }]);

  // someone else saved meanwhile
  server.scripts.set('upload/types', { content: 'theirs', revision: 5 });
  saveScript('p1', 'upload/types', 'mine');
  await flushScripts('p1');
  expect(projectScripts('p1').save).toBe('conflict');
});

test('larger than 1 MB: not sent, it says why; new paths follow the rules and what the page knows', async () => {
  saveScript('p1', 'upload/types', 'x'.repeat(1024 * 1024 + 1));
  expect(projectScripts('p1')).toMatchObject({ save: 'error', saveError: 'The script takes 1.0 MB (at most 1 MB).' });

  expect(newPathIssue('p1', 'upload/types')).toBe('A script with this path already exists.');
  expect(newPathIssue('p1', 'upload')).toBe('A folder with this path already exists.');
  expect(newPathIssue('p1', 'apis/client')).toBeNull();
  expect(await createScriptPath('p1', 'apis/client', 'script')).toBeNull();
  expect(projectScripts('p1').scripts.map(s => s.path)).toContain('apis/client');
});
