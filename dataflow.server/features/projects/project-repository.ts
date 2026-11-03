import { sql } from 'drizzle-orm';
import type { Database } from '#shared/database/database';
import { OrgRepository } from '#shared/database/repository';
import { projects } from './project';

/**
 * Projects of ONE organization: the orgId comes in the constructor and every query filters by it, so a repository
 * built for org A cannot see org B's projects. Deleted projects are left out.
 */
export class ProjectRepository extends OrgRepository<typeof projects> {
  constructor(db: Database, orgId: string) {
    super(db, projects, orgId);
  }

  /** whether a live project already has this name (case-insensitive) */
  existsByName(name: string): Promise<boolean> {
    return this.exists(sql`lower(${projects.name}) = lower(${name})`);
  }
}
