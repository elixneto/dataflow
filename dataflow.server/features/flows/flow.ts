import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { jsonb } from '#shared/database/jsonb';
import { folders } from '#features/folders/folder';
import { organizations } from '#features/organizations/organization';
import { projects } from '#features/projects/project';

/**
 * Follows migrations/1_initial.sql. name and folder_id are metadata of the row, never part of
 * flow_versions (definition, content_hash): renaming or moving a flow keeps its id and touches no version, deployment
 * or deployment history, so it needs no deploy.
 */
export const flows = pgTable('flows', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  /** null = at the project's root */
  folderId: uuid('folder_id').references(() => folders.id),
  name: text('name').notNull(),
  /** the editor's current draft of the flow; null where readonly = true */
  draftDefinition: jsonb('draft_definition'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: text('deleted_by'),
});

export type Flow = typeof flows.$inferSelect;
