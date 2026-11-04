import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from '#features/organizations/organization';
import { projects } from '#features/projects/project';

/** follows migrations/4_secrets_variables_connections.sql: plain values flows read as ENV_VARIABLES['name'] */
export const variables = pgTable('variables', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  name: text('name').notNull(),
  value: text('value').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Variable = typeof variables.$inferSelect;

export type VariableView = Omit<Variable, 'orgId'>;

export const toVariableView = ({ orgId: _orgId, ...variable }: Variable): VariableView => variable;
