import { insideScriptFolder, movedScriptPath, normalizeScriptPath, scriptExports, scriptImport, scriptImports, scriptPathIssue, type ScriptExport } from '@dataflow/core';
import type { Database } from '#shared/database/database';

/*
 * A project's scripts in the database: their paths and code (with a revision, as the flow drafts: a save over a
 * newer one is refused), the names each one exports (the editor offers them without loading every script), and the
 * folders that hold no script yet. Paths follow the core's rules. A run takes only the scripts it imports, by the
 * hash of their code (script_blobs: written once, shared).
 */

/** a script in the list: no code (loaded on its own, when opened) */
export type ScriptEntry = { path: string; revision: number; exports: ScriptExport[]; updatedBy: string | null; updatedAt: Date };

export async function listScripts(db: Database, orgId: string, projectId: string): Promise<{ scripts: ScriptEntry[]; folders: string[] }> {
  const scripts = await db.query<ScriptEntry>(
    `SELECT path, revision, exports, updated_by AS "updatedBy", updated_at AS "updatedAt" FROM scripts WHERE org_id = $1 AND project_id = $2 ORDER BY path`,
    [orgId, projectId],
  );
  const folders = await db.query<{ path: string }>('SELECT path FROM script_folders WHERE org_id = $1 AND project_id = $2 ORDER BY path', [orgId, projectId]);
  return { scripts, folders: folders.map(f => f.path) };
}

/** a script's code and the revision it is at */
export async function getScript(db: Database, orgId: string, projectId: string, path: string): Promise<{ path: string; content: string; revision: number } | null> {
  const [row] = await db.query<{ path: string; content: string; revision: number }>(
    'SELECT path, content, revision FROM scripts WHERE org_id = $1 AND project_id = $2 AND path = $3',
    [orgId, projectId, path],
  );
  return row ?? null;
}

/** what the list keeps of a script's code: the names it exports */
export const exportsOf = (content: string) => JSON.stringify(scriptExports(content));

const sha256 = (text: string) => new Bun.CryptoHasher('sha256').update(text).digest('hex');

/** a TypeScript component of a flow: its name (for the errors) and its code */
export type ScriptUser = { label: string; code: string };

/**
 * The scripts some components import, and those import in turn, by the hash of their code as it is now: the code goes
 * to script_blobs (once per hash). Read level by level: only the scripts needed. `error`: an import of a script that
 * does not exist, naming the component (and the script it goes through).
 */
export async function scriptsForRun(db: Database, orgId: string, projectId: string, users: ScriptUser[]): Promise<{ scripts: Record<string, string>; error?: string }> {
  const contents = new Map<string, string>();
  for (const user of users) {
    let wanted = scriptImports(user.code).map(path => ({ path, from: null as string | null }));
    while (wanted.length > 0) {
      const fresh = wanted.filter(w => !contents.has(w.path));
      const rows = fresh.length
        ? await db.query<{ path: string; content: string }>('SELECT path, content FROM scripts WHERE org_id = $1 AND project_id = $2 AND path = ANY($3::text[])', [
            orgId,
            projectId,
            [...new Set(fresh.map(w => w.path))],
          ])
        : [];
      rows.forEach(r => contents.set(r.path, r.content));
      const missing = fresh.find(w => !contents.has(w.path));
      if (missing) {
        const through = missing.from ? ` (through ${scriptImport(missing.from)})` : '';
        return { scripts: {}, error: `"${user.label}" imports ${scriptImport(missing.path)}${through}, which does not exist.` };
      }

      wanted = rows.flatMap(r => scriptImports(r.content).map(path => ({ path, from: r.path }))).filter(w => !contents.has(w.path));
    }
  }

  const scripts: Record<string, string> = {};
  for (const [path, content] of contents) {
    const hash = sha256(content);
    await db.query('INSERT INTO script_blobs (org_id, hash, content) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [orgId, hash, content]);
    scripts[path] = hash;
  }

  return { scripts };
}

/** the code of some script blobs, by hash */
export async function scriptBlobs(db: Database, orgId: string, hashes: string[]): Promise<Map<string, string>> {
  if (hashes.length === 0) return new Map();
  const rows = await db.query<{ hash: string; content: string }>('SELECT hash, content FROM script_blobs WHERE org_id = $1 AND hash = ANY($2::text[])', [orgId, hashes]);
  return new Map(rows.map(r => [r.hash, r.content]));
}

/** every folder of the project: the ones above a script or an empty folder, and the empty ones */
export const allFolders = (scripts: { path: string }[], folders: string[]) => {
  const all = new Set(folders);
  for (const path of [...scripts.map(s => s.path), ...folders]) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) all.add(parts.slice(0, i).join('/'));
  }
  return [...all].sort();
};

/** what makes `text` impossible as a new script's or folder's path: invalid, taken, or inside a script */
export async function newPathIssue(db: Database, orgId: string, projectId: string, text: string): Promise<string | null> {
  const path = normalizeScriptPath(text);
  const issue = scriptPathIssue(path);
  if (issue) return issue;
  const { scripts, folders } = await listScripts(db, orgId, projectId);
  if (scripts.some(s => s.path === path)) return 'A script with this path already exists.';
  if (allFolders(scripts, folders).includes(path)) return 'A folder with this path already exists.';
  if (scripts.some(s => path.startsWith(`${s.path}/`))) return 'A script cannot hold other scripts: pick another folder.';
  return null;
}

/** who imports a script or anything in a folder: the project's flows (their TypeScript code) and other scripts */
export async function scriptUsage(db: Database, orgId: string, projectId: string, path: string): Promise<{ flows: { id: string; name: string }[]; scripts: string[] }> {
  const imports = (code: string) => scriptImports(code).some(p => insideScriptFolder(p, path));
  const scripts = await db.query<{ path: string; content: string }>('SELECT path, content FROM scripts WHERE org_id = $1 AND project_id = $2', [orgId, projectId]);
  const flows = await db.query<{ id: string; name: string; draft: unknown }>(
    `SELECT id, name, draft_definition AS draft FROM flows WHERE org_id = $1 AND project_id = $2 AND deleted_at IS NULL`,
    [orgId, projectId],
  );
  const codeOf = (draft: unknown) =>
    ((draft as { flow?: { nodes?: { type: string; config?: { code?: unknown } }[] } } | null)?.flow?.nodes ?? [])
      .filter(n => n.type === 'typescript')
      .map(n => String(n.config?.code ?? ''))
      .join('\n');
  return {
    flows: flows.filter(f => imports(codeOf(f.draft))).map(f => ({ id: f.id, name: f.name })),
    scripts: scripts.filter(s => !insideScriptFolder(s.path, path) && imports(s.content)).map(s => s.path),
  };
}

/** renames (moves) a script or a folder with everything in it */
export async function moveScriptPath(db: Database, orgId: string, projectId: string, from: string, to: string, userId: string) {
  await db.transaction(async tx => {
    const { scripts, folders } = await listScripts(tx, orgId, projectId);
    for (const script of scripts.filter(s => insideScriptFolder(s.path, from))) {
      await tx.query(
        'UPDATE scripts SET path = $4, revision = revision + 1, updated_by = $5, updated_at = now() WHERE org_id = $1 AND project_id = $2 AND path = $3',
        [orgId, projectId, script.path, movedScriptPath(script.path, from, to), userId],
      );
    }
    for (const folder of folders.filter(f => insideScriptFolder(f, from))) {
      await tx.query('UPDATE script_folders SET path = $4 WHERE org_id = $1 AND project_id = $2 AND path = $3', [orgId, projectId, folder, movedScriptPath(folder, from, to)]);
    }
  });
}

/** deletes a script, or a folder with everything in it */
export async function deleteScriptPath(db: Database, orgId: string, projectId: string, path: string) {
  await db.query(`DELETE FROM scripts WHERE org_id = $1 AND project_id = $2 AND (path = $3 OR starts_with(path, $3 || '/'))`, [orgId, projectId, path]);
  await db.query(`DELETE FROM script_folders WHERE org_id = $1 AND project_id = $2 AND (path = $3 OR starts_with(path, $3 || '/'))`, [orgId, projectId, path]);
}
