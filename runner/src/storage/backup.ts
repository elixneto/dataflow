import {rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import type {Repository} from './repository';

/*
 * Backup of the local database (PGlite, runner/data.local/), written when the runner starts: projects and flows as
 * JSON, outside git. The one from the start before is kept as `.previous`, so a start on a broken or empty database
 * does not overwrite the last good copy with nothing. Runs are not in it (they are history, and they can be large).
 */

const BACKUP = fileURLToPath(new URL('../../data.local.backup.json', import.meta.url));
const PREVIOUS = fileURLToPath(new URL('../../data.local.backup.previous.json', import.meta.url));

export async function backupWorkspace(repo: Repository) {
  const projects = await repo.listProjects();
  const flows = await repo.listFlows();
  await rename(BACKUP, PREVIOUS).catch(() => undefined);
  await Bun.write(BACKUP, JSON.stringify({savedAt: new Date().toISOString(), projects, flows}, null, 2));
  return {projects: projects.length, flows: flows.length};
}
