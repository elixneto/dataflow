import { and, ne, sql } from 'drizzle-orm';
import type { Database } from '#shared/database/database';
import { OrgRepository } from '#shared/database/repository';
import { projects } from './project';

/**
 * Projects of ONE organization: the orgId comes in the constructor and every query filters by it, so a repository
 * built for org A cannot see org B's projects. Archived (soft deleted) projects are left out unless a method says so.
 */
export class ProjectRepository extends OrgRepository<typeof projects> {
  constructor(db: Database, orgId: string) {
    super(db, projects, orgId);
  }

  /** whether a live project already has this name (case-insensitive); `exceptId` leaves that project out (an edit) */
  existsByName(name: string, exceptId?: string): Promise<boolean> {
    const sameName = sql`lower(${projects.name}) = lower(${name})`;
    return this.exists(exceptId ? and(sameName, ne(projects.id, exceptId))! : sameName);
  }
}
