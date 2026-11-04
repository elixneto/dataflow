import { type AnyPgColumn, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from '#features/organizations/organization';
import { projects } from '#features/projects/project';

/** follows migrations/1_initial.sql: only a visual organization of a project's flows */
export const folders = pgTable('folders', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  /** null = at the project's root */
  parentId: uuid('parent_id').references((): AnyPgColumn => folders.id),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: text('deleted_by'),
});

export type Folder = typeof folders.$inferSelect;
