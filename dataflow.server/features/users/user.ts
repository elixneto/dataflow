import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from '#features/organizations/organization';

/** follows migrations/1_initial.sql: the people of an organization (no credentials yet: there is no login) */
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
