import {mkdir, readdir, rm, stat} from 'node:fs/promises';
import {Hono} from 'hono';

/*
 * What belongs to each project and lives in the runner while there is no database: secrets and files.
 * Secrets: runner/secrets.local.json (outside git). A text value at the top level applies to every project (shared);
 * a project's own ones live in "projects": {"<projectId>": {"NAME": "value"}} and win over a shared one with the same name.
 * The API never returns a secret value, only the names.
 * Files: runner/files.local/<projectId>/ (outside git).
 */

const SECRETS_FILE = new URL('../secrets.local.json', import.meta.url);
const FILES_FOLDER = new URL('../files.local/', import.meta.url);

type SecretsFile = Record<string, unknown> & {projects?: Record<string, Record<string, string>>};

async function readSecretsFile(): Promise<SecretsFile> {
  const file = Bun.file(SECRETS_FILE);
  if (!(await file.exists())) return {};
  try {
    return await file.json();
  } catch {
    console.error('secrets.local.json is not valid JSON; continuing without secrets.');
    return {};
  }
}

const shared = (content: SecretsFile) =>
  Object.fromEntries(Object.entries(content).filter(([, v]) => typeof v === 'string')) as Record<string, string>;

/** Secrets of a run: the shared ones and, on top, the project's. Read on every run (can be changed without restarting). */
export async function projectSecrets(projectId?: string): Promise<Record<string, string>> {
  const content = await readSecretsFile();
  return {...shared(content), ...(projectId ? content.projects?.[projectId] ?? {} : {})};
}

const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** project id and file name become a path: no "..", slash or odd characters */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const safeFileName = (name: string) => !!name && name.length <= 200 && !/[\\/:*?"<>|]/.test(name) && name !== '.' && name !== '..';

export const projectRoutes = new Hono();

projectRoutes.use('/projects/:projectId/*', async (c, next) => {
  if (!SAFE_ID.test(c.req.param('projectId'))) return c.json({error: 'Invalid project.'}, 400);
  await next();
});

projectRoutes.get('/projects/:projectId/secrets', async c => {
  const content = await readSecretsFile();
  const ofProject = Object.keys(content.projects?.[c.req.param('projectId')] ?? {});
  const all = Object.keys(shared(content));
  return c.json([
    ...ofProject.map(name => ({name, source: 'project'})),
    ...all.filter(name => !ofProject.includes(name)).map(name => ({name, source: 'shared'})),
  ].sort((a, b) => a.name.localeCompare(b.name)));
});

projectRoutes.put('/projects/:projectId/secrets/:name', async c => {
  const {projectId, name} = c.req.param();
  if (!SECRET_NAME.test(name)) return c.json({error: 'Invalid secret name (letters, digits and _).'}, 400);
  const {value} = await c.req.json<{value?: string}>();
  if (typeof value !== 'string' || !value) return c.json({error: 'Enter the value.'}, 400);
  const content = await readSecretsFile();
  content.projects ??= {};
  content.projects[projectId] = {...content.projects[projectId], [name]: value};
  await Bun.write(SECRETS_FILE, JSON.stringify(content, null, 2));
  return c.json({ok: true});
});

projectRoutes.delete('/projects/:projectId/secrets/:name', async c => {
  const {projectId, name} = c.req.param();
  const content = await readSecretsFile();
  if (!content.projects?.[projectId]?.[name]) return c.json({error: 'Only project secrets can be deleted (the shared ones stay in the file).'}, 404);
  delete content.projects[projectId][name];
  await Bun.write(SECRETS_FILE, JSON.stringify(content, null, 2));
  return c.json({ok: true});
});

const projectFolder = (projectId: string) => new URL(`${projectId}/`, FILES_FOLDER);

projectRoutes.get('/projects/:projectId/files', async c => {
  const folder = projectFolder(c.req.param('projectId'));
  let names: string[];
  try {
    names = await readdir(folder);
  } catch {
    return c.json([]);
  }
  const files = await Promise.all(names.map(async name => {
    const info = await stat(new URL(encodeURIComponent(name), folder));
    return {name, size: info.size, updatedAt: info.mtime.toISOString()};
  }));
  return c.json(files.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
});

/** Upload by multipart ("file" field); a file with the same name is replaced. */
projectRoutes.post('/projects/:projectId/files', async c => {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json({error: 'Send the file in the "file" field.'}, 400);
  if (!safeFileName(file.name)) return c.json({error: 'Invalid file name.'}, 400);
  const folder = projectFolder(c.req.param('projectId'));
  await mkdir(folder, {recursive: true});
  await Bun.write(new URL(encodeURIComponent(file.name), folder), file);
  return c.json({ok: true, name: file.name, size: file.size});
});

projectRoutes.get('/projects/:projectId/files/:name', async c => {
  const name = c.req.param('name');
  if (!safeFileName(name)) return c.json({error: 'Invalid file name.'}, 400);
  const file = Bun.file(new URL(encodeURIComponent(name), projectFolder(c.req.param('projectId'))));
  if (!(await file.exists())) return c.json({error: 'File not found.'}, 404);
  return new Response(file, {headers: {'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`}});
});

projectRoutes.delete('/projects/:projectId/files/:name', async c => {
  const name = c.req.param('name');
  if (!safeFileName(name)) return c.json({error: 'Invalid file name.'}, 400);
  await rm(new URL(encodeURIComponent(name), projectFolder(c.req.param('projectId'))), {force: true});
  return c.json({ok: true});
});
