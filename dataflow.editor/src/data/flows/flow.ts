/*
 * What a project holds: folders, nested to any depth, and flows, at the root or in a folder (flows-api.ts loads and
 * changes them on dataflow.server). Folders are only organization: a flow keeps its id when it moves or is renamed.
 * A flow has only a name: the project's icon and color stand for its flows.
 */

export { NAME_MAX, validateName } from '@dataflow/core';

export type Folder = {
  id: string;
  projectId: string;
  /** null = at the project's root */
  parentId: string | null;
  name: string;
  createdAt: Date;
  /** when it was archived (with everything under it); null while it is active */
  archivedAt: Date | null;
};

export type Flow = {
  id: string;
  projectId: string;
  /** null = at the project's root */
  folderId: string | null;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string;
  /** who that is, by name (the server's users), when known */
  updatedByName?: string;
  /** when it was archived; null while it is active */
  archivedAt: Date | null;
};

export type FlowStatus = 'active' | 'archived';

/** everything a project holds, archived included (project-tree.ts says what is visible) */
export type ProjectContents = { folders: Folder[]; flows: Flow[] };
