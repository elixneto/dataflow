import { eq } from 'drizzle-orm';
import type { Database } from '#shared/database/database';
import { OrgRepository } from '#shared/database/repository';
import { variables, type Variable } from './variable';

export class VariableRepository extends OrgRepository<typeof variables> {
  constructor(db: Database, orgId: string) {
    super(db, variables, orgId);
  }

  /** the project's variables by name */
  async ofProject(projectId: string): Promise<Variable[]> {
    return (await this.findMany(eq(variables.projectId, projectId))).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  }
}
