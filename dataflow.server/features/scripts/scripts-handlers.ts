import { z } from 'zod';
import { normalizeScriptPath, scriptContentIssue } from '@dataflow/core';
import { requireActiveProject } from '#features/folders/project-tree';
import { GetProjectHandler } from '#features/projects/get-project/get-project-handler';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import { allFolders, deleteScriptPath, exportsOf, getScript, listScripts, moveScriptPath, newPathIssue, scriptUsage, type ScriptEntry } from './script-store';

/*
 * A project's scripts (/projects/:id/scripts): list, create (a script or a folder), save (with the revision it was
 * read at: a newer one elsewhere is a conflict, as the flow drafts), move (rename) and delete a script or a folder
 * with everything in it, and who imports a path (the flows and scripts a move or a delete would break).
 */

const projectId = z.uuid('Invalid');
const path = z.string().transform(normalizeScriptPath);
const invalidPath = (error: string) => fail('validation', 'The request has invalid fields.', { path: error });
const conflict = () => fail('conflict', 'This script was changed elsewhere. Reload it to see the latest version.');
const tooLarge = (error: string) => fail('validation', 'The request has invalid fields.', { content: error });

/** the scripts without their code (each with the names it exports), and every folder */
export type ScriptsView = { scripts: ScriptEntry[]; folders: string[] };

export class ListScriptsHandler implements UseCaseHandler<ScriptsView> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<ScriptsView>> {
    const parsed = validate(z.object({ projectId }), input);
    if (!parsed.ok) {
      return parsed;
    }

    const project = await new GetProjectHandler().handle({ id: parsed.value.projectId }, ctx);
    if (!project.ok) {
      return project;
    }

    const { scripts, folders } = await listScripts(ctx.db, ctx.orgId, parsed.value.projectId);
    return success({ scripts, folders: allFolders(scripts, folders) });
  }
}

/** a new script (`kind` script, with its code or an example) or an empty folder */
export class CreateScriptPathHandler implements UseCaseHandler<{ path: string; revision: number }> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<{ path: string; revision: number }>> {
    const parsed = validate(z.object({ projectId, path, kind: z.enum(['script', 'folder']), content: z.string().optional() }), input);
    if (!parsed.ok) {
      return parsed;
    }

    const { projectId: id, path: target, kind, content } = parsed.value;
    const missing = await requireActiveProject(ctx, id);
    if (missing && !missing.ok) {
      return missing;
    }

    const issue = await newPathIssue(ctx.db, ctx.orgId, id, target);
    if (issue) {
      return issue.includes('already exists') ? fail('conflict', issue, { path: issue }) : invalidPath(issue);
    }

    const code = content ?? `export function example(): string {\n  return 'hello';\n}\n`;
    const large = scriptContentIssue(code);
    if (large) {
      return tooLarge(large);
    }

    if (kind === 'folder') {
      await ctx.db.query('INSERT INTO script_folders (org_id, project_id, path) VALUES ($1, $2, $3)', [ctx.orgId, id, target]);
      return success({ path: target, revision: 0 });
    }

    await ctx.db.query('INSERT INTO scripts (id, org_id, project_id, path, content, exports, updated_by) VALUES ($1, $2, $3, $4, $5, $6::text::jsonb, $7)', [
      crypto.randomUUID(),
      ctx.orgId,
      id,
      target,
      code,
      exportsOf(code),
      ctx.userId,
    ]);
    return success({ path: target, revision: 0 });
  }
}

/** a script's code, over the revision it was read at (a save from elsewhere in between: conflict) */
export class SaveScriptHandler implements UseCaseHandler<{ revision: number }> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<{ revision: number }>> {
    const parsed = validate(z.object({ projectId, path, content: z.string(), revision: z.number().int().min(0) }), input);
    if (!parsed.ok) {
      return parsed;
    }

    const { projectId: id, path: target, content, revision } = parsed.value;
    const missing = await requireActiveProject(ctx, id);
    if (missing && !missing.ok) {
      return missing;
    }

    const large = scriptContentIssue(content);
    if (large) {
      return tooLarge(large);
    }

    const [saved] = await ctx.db.query<{ revision: number }>(
      `UPDATE scripts SET content = $4, exports = $7::text::jsonb, revision = revision + 1, updated_by = $6, updated_at = now()
       WHERE org_id = $1 AND project_id = $2 AND path = $3 AND revision = $5 RETURNING revision`,
      [ctx.orgId, id, target, content, revision, ctx.userId, exportsOf(content)],
    );
    if (saved) {
      return success({ revision: saved.revision });
    }

    const [exists] = await ctx.db.query('SELECT 1 FROM scripts WHERE org_id = $1 AND project_id = $2 AND path = $3', [ctx.orgId, id, target]);
    return exists ? conflict() : fail('not-found', 'Script not found.');
  }
}

/** renames (moves) a script or a folder with what it holds */
export class MoveScriptPathHandler implements UseCaseHandler<{ path: string }> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<{ path: string }>> {
    const parsed = validate(z.object({ projectId, from: path, to: path }), input);
    if (!parsed.ok) {
      return parsed;
    }

    const { projectId: id, from, to } = parsed.value;
    const missing = await requireActiveProject(ctx, id);
    if (missing && !missing.ok) {
      return missing;
    }

    if (from === to) {
      return success({ path: to });
    }

    const issue = await newPathIssue(ctx.db, ctx.orgId, id, to);
    if (issue) {
      return issue.includes('already exists') ? fail('conflict', issue, { path: issue }) : invalidPath(issue);
    }

    await moveScriptPath(ctx.db, ctx.orgId, id, from, to, ctx.userId);
    return success({ path: to });
  }
}

export class DeleteScriptPathHandler implements UseCaseHandler<{ path: string }> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<{ path: string }>> {
    const parsed = validate(z.object({ projectId, path }), input);
    if (!parsed.ok) {
      return parsed;
    }

    const missing = await requireActiveProject(ctx, parsed.value.projectId);
    if (missing && !missing.ok) {
      return missing;
    }

    await deleteScriptPath(ctx.db, ctx.orgId, parsed.value.projectId, parsed.value.path);
    return success({ path: parsed.value.path });
  }
}

/** who imports a path (a script, or anything in a folder): before a move or a delete */
export class ScriptUsageHandler implements UseCaseHandler<{ flows: { id: string; name: string }[]; scripts: string[] }> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<{ flows: { id: string; name: string }[]; scripts: string[] }>> {
    const parsed = validate(z.object({ projectId, path }), input);
    if (!parsed.ok) {
      return parsed;
    }

    const project = await new GetProjectHandler().handle({ id: parsed.value.projectId }, ctx);
    if (!project.ok) {
      return project;
    }

    return success(await scriptUsage(ctx.db, ctx.orgId, parsed.value.projectId, parsed.value.path));
  }
}

/** a script's code and the revision it is at (opened in the editor, or imported by the code open there) */
export class GetScriptHandler implements UseCaseHandler<{ path: string; content: string; revision: number }> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<{ path: string; content: string; revision: number }>> {
    const parsed = validate(z.object({ projectId, path }), input);
    if (!parsed.ok) {
      return parsed;
    }

    const project = await new GetProjectHandler().handle({ id: parsed.value.projectId }, ctx);
    if (!project.ok) {
      return project;
    }

    const script = await getScript(ctx.db, ctx.orgId, parsed.value.projectId, parsed.value.path);
    return script ? success(script) : fail('not-found', 'Script not found.');
  }
}
