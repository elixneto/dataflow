import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { jsonb } from '#shared/database/jsonb';
import { organizations } from '#features/organizations/organization';
import { projects } from '#features/projects/project';

/**
 * Follows migrations/1_initial.sql. The config holds the fields of the type (@dataflow/core
 * connection-types); its sensitive fields name secrets of the project, never a value.
 */
export const connections = pgTable('connections', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  name: text('name').notNull(),
  type: text('type').notNull(),
  config: jsonb('config').$type<Record<string, string>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Connection = typeof connections.$inferSelect;

export type ConnectionView = Omit<Connection, 'orgId'>;

export const toConnectionView = ({ orgId: _orgId, ...connection }: Connection): ConnectionView => connection;
