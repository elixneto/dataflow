import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { flows, type Flow } from '#features/flows/flow';
import { ProjectRepository } from '#features/projects/project-repository';
import { OrgRepository } from '#shared/database/repository';
import type { Database } from '#shared/database/database';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import { fail, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { folders, type Folder } from './folder';

/*
 * A project's folders and flows as one tree. The rules (unique names among siblings, no folder inside itself, what is
 * visible) are @dataflow/core's folder-tree, the same the editor shows as you type: handlers load the project's tree
 * and apply them in memory (a project holds tens or hundreds of items, not millions).
 */

export class FolderRepository extends OrgRepository<typeof folders> {
  constructor(db: Database, orgId: string) {
    super(db, folders, orgId);
  }
}

export class FlowRepository extends OrgRepository<typeof flows> {
  constructor(db: Database, orgId: string) {
    super(db, flows, orgId);
  }
}

/** every folder and flow of the project, archived included (the core rules use archivedAt) */
export type ProjectTree = {
  folders: (Folder & { archivedAt: Date | null })[];
  flows: (Flow & { archivedAt: Date | null })[];
};

export async function loadTree(db: Database, orgId: string, projectId: string): Promise<ProjectTree> {
  const [folderRows, flowRows] = await Promise.all([
    new FolderRepository(db, orgId).findAll(eq(folders.projectId, projectId)),
    new FlowRepository(db, orgId).findAll(eq(flows.projectId, projectId)),
  ]);

  return {
    folders: folderRows.map(row => ({ ...row, archivedAt: row.deletedAt })),
    flows: flowRows.map(row => ({ ...row, archivedAt: row.deletedAt })),
  };
}

/** the project, when it is the organization's and active: an archived project takes no new folders or flows */
export async function requireActiveProject(ctx: UseCaseContext, projectId: string): Promise<UseCaseResult<{ id: string }> | null> {
  const project = await new ProjectRepository(ctx.db, ctx.orgId).findById(projectId);
  return project ? null : fail('not-found', 'Project not found.');
}

/** a folder id, or null for the project's root */
export const location = z.uuid('Invalid').nullable().default(null);

export type FolderView = {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  createdAt: Date;
  archivedAt: Date | null;
};

export type FlowView = {
  id: string;
  projectId: string;
  folderId: string | null;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
  archivedAt: Date | null;
};

export const toFolderView = (folder: Folder): FolderView => ({
  id: folder.id,
  projectId: folder.projectId,
  parentId: folder.parentId,
  name: folder.name,
  createdAt: folder.createdAt,
  archivedAt: folder.deletedAt,
});

export const toFlowView = (flow: Flow): FlowView => ({
  id: flow.id,
  projectId: flow.projectId,
  folderId: flow.folderId,
  name: flow.name,
  createdAt: flow.createdAt,
  updatedAt: flow.updatedAt,
  updatedBy: flow.updatedBy,
  archivedAt: flow.deletedAt,
});

/** the answer when a name is taken next to where the item goes */
export const nameTaken = (kind: 'folder' | 'flow', name: string) =>
  fail('conflict', `A ${kind} named "${name}" is already there.`, { name: 'Already in use' });

/** the answer for an invalid name (required, too long) */
export const invalidName = (error: string) => fail('validation', 'The request has invalid fields.', { name: error });
