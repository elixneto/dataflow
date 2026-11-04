import { afterEach, describe, expect, test } from 'bun:test';
import {
  archiveProject,
  createProject,
  listProjects,
  restoreProject,
  toProject,
  updateProject,
} from '../src/data/projects/projects-api';
import { validateNewProject, type NewProject, type Project } from '../src/data/projects/project';

const input = (fields: Partial<NewProject>): NewProject => ({ name: 'Ok', description: '', icon: 'folder', color: 'blue', ...fields });

const existing: Project[] = [
  { id: '1', name: 'Sales', description: '', icon: 'cart', color: 'green', createdAt: new Date('2026-10-20T09:00:00Z'), archivedAt: null },
];

describe('new project', () => {
  test('trims the fields and accepts a new name', () => {
    const result = validateNewProject(input({ name: '  Marketing  ', description: ' Campaigns ', icon: 'mail', color: 'pink' }), existing);

    expect(result).toEqual({ value: { name: 'Marketing', description: 'Campaigns', icon: 'mail', color: 'pink' }, errors: {} });
  });

  test('the name is required and at most 100 characters', () => {
    expect(validateNewProject(input({ name: '   ' }), []).errors).toEqual({ name: 'Required' });
    expect(validateNewProject(input({ name: 'x'.repeat(101) }), []).errors).toEqual({ name: 'At most 100 characters' });
  });

  test('the name is unique, ignoring case', () => {
    expect(validateNewProject(input({ name: 'SALES' }), existing).errors).toEqual({ name: 'Already in use' });
  });

  test('editing keeps its own name', () => {
    expect(validateNewProject(input({ name: 'sales' }), existing, '1').errors).toEqual({});
  });

  test('the description is at most 500 characters', () => {
    expect(validateNewProject(input({ description: 'x'.repeat(501) }), []).errors).toEqual({ description: 'At most 500 characters' });
  });

  test('icon and color must be known', () => {
    const unknown = input({ icon: 'unicorn' as NewProject['icon'], color: 'gold' as NewProject['color'] });

    expect(validateNewProject(unknown, []).errors).toEqual({ icon: 'Unknown icon', color: 'Unknown color' });
  });
});

describe('projects api', () => {
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

  test('a dto becomes a project; unknown icon or color falls back to the default', () => {
    const project = toProject({ id: '1', name: 'A', description: '', icon: 'rocket-ship', color: 'gold', createdAt: '2026-11-03T10:00:00.000Z', archivedAt: null });

    expect(project).toEqual({ id: '1', name: 'A', description: '', icon: 'folder', color: 'blue', createdAt: new Date('2026-11-03T10:00:00.000Z'), archivedAt: null });
  });

  test('lists through /api/projects with the organization and user headers', async () => {
    answer(200, { items: [{ id: '1', name: 'Sales', description: '', icon: 'cart', color: 'green', createdAt: '2026-10-20T09:00:00.000Z', archivedAt: null }] });

    const result = await listProjects();

    expect(result).toEqual({ ok: true, value: [existing[0]!] });
    expect(calls[0]!.url).toBe('/api/projects?status=active');
    expect(calls[0]!.init.headers).toMatchObject({ 'x-org-id': '00000000-0000-4000-8000-000000000001', 'x-user-id': 'ana' });
  });

  test('a conflict comes back with its field errors', async () => {
    const error = { code: 'conflict', message: 'A project named "Sales" already exists.', fields: { name: 'Already in use' } };
    answer(409, { error });

    expect(await createProject(input({ name: 'Sales' }))).toEqual({ ok: false, error });
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual(input({ name: 'Sales' }));
  });

  test('archived list, edit, archive and restore call their routes', async () => {
    const dto = { id: '1', name: 'Sales', description: '', icon: 'cart', color: 'green', createdAt: '2026-10-20T09:00:00.000Z', archivedAt: '2026-11-03T12:00:00.000Z' };
    answer(200, { items: [dto] });
    const archived = await listProjects('archived');
    answer(200, { ...dto, archivedAt: null, description: 'Edited' });
    const updated = await updateProject('1', { description: 'Edited' });
    answer(200, { id: '1' });
    await archiveProject('1');
    answer(200, { ...dto, archivedAt: null });
    const restored = await restoreProject('1');

    expect(calls.map(call => `${call.init.method} ${call.url}`)).toEqual([
      'GET /api/projects?status=archived',
      'PATCH /api/projects/1',
      'POST /api/projects/1/archive',
      'POST /api/projects/1/restore',
    ]);
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ description: 'Edited' });
    expect(archived).toMatchObject({ ok: true, value: [{ archivedAt: new Date('2026-11-03T12:00:00.000Z') }] });
    expect(updated).toMatchObject({ ok: true, value: { description: 'Edited', archivedAt: null } });
    expect(restored).toMatchObject({ ok: true, value: { id: '1', archivedAt: null } });
  });

  test('server down: a friendly error', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const viaProxy = await listProjects();
    answer(502);
    const proxyError = await listProjects();

    expect(viaProxy).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(proxyError).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  });
});
