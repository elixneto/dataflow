import type {RunRecord} from '@dataflow/core';
import type {Database} from './database';

/*
 * Reading and writing projects, flows and runs. The flow is stored as the editor's lean definition (a document);
 * the columns beside it (project, folder, name...) exist to list and filter without opening the document.
 */

export type Project = {
  id: string;
  name: string;
  description: string;
  folders?: string[];
  updatedAt: string;
};

/** the editor's FlowDefinition: the runner only reads the fields it indexes */
export type FlowDefinition = Record<string, unknown> & {
  id: string;
  projectId: string;
  folder?: string;
  name: string;
  status?: string;
  version?: number;
  updatedAt?: string;
};

/** stored record with the project and flow it came from (to list by project and go back to the flow) */
export type StoredRun = RunRecord & {projectId?: string; workflowId?: string};

const iso = (value: unknown) => (value instanceof Date ? value : new Date(String(value))).toISOString();

type ProjectRow = {id: string; name: string; description: string; folders: string[]; updated_at: Date};

const toProject = (row: ProjectRow): Project => ({
  id: row.id, name: row.name, description: row.description, updatedAt: iso(row.updated_at),
  ...(row.folders.length ? {folders: row.folders} : {}),
});

/*
 * Documents go as JSON text cast in the SQL ($n::text::jsonb): each driver encodes a JS value its own way (Bun.sql would
 * store a string as a JSON string, and an array as a Postgres array).
 */
export function repository(db: Database) {
  async function saveProject(project: Project, client: Database = db) {
    await client.query(
      `INSERT INTO projects (id, name, description, folders, updated_at) VALUES ($1, $2, $3, $4::text::jsonb, $5)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, description = excluded.description,
         folders = excluded.folders, updated_at = excluded.updated_at`,
      [project.id, project.name, project.description ?? '', JSON.stringify(project.folders ?? []), project.updatedAt ?? new Date().toISOString()],
    );
  }

  async function saveFlow(flow: FlowDefinition, client: Database = db) {
    await client.query(
      `INSERT INTO flows (id, project_id, folder, name, status, version, updated_at, definition) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text::jsonb)
       ON CONFLICT (id) DO UPDATE SET project_id = excluded.project_id, folder = excluded.folder, name = excluded.name,
         status = excluded.status, version = excluded.version, updated_at = excluded.updated_at, definition = excluded.definition`,
      [flow.id, flow.projectId, flow.folder ?? '', flow.name, flow.status ?? 'draft', flow.version ?? 0,
        flow.updatedAt ?? new Date().toISOString(), JSON.stringify(flow)],
    );
  }

  return {
    async listProjects(): Promise<Project[]> {
      return (await db.query<ProjectRow>('SELECT * FROM projects ORDER BY name')).map(toProject);
    },

    async getProject(id: string): Promise<Project | undefined> {
      const [row] = await db.query<ProjectRow>('SELECT * FROM projects WHERE id = $1', [id]);
      return row && toProject(row);
    },

    saveProject: (project: Project) => saveProject(project),

    /** deletes the project and its flows (its runs stay, as history) */
    async deleteProject(id: string): Promise<boolean> {
      return (await db.query('DELETE FROM projects WHERE id = $1 RETURNING id', [id])).length > 0;
    },

    async listFlows(projectId?: string): Promise<FlowDefinition[]> {
      const rows = projectId
        ? await db.query<{definition: FlowDefinition}>('SELECT definition FROM flows WHERE project_id = $1 ORDER BY name', [projectId])
        : await db.query<{definition: FlowDefinition}>('SELECT definition FROM flows ORDER BY name');
      return rows.map(r => r.definition);
    },

    async getFlow(id: string): Promise<FlowDefinition | undefined> {
      const [row] = await db.query<{definition: FlowDefinition}>('SELECT definition FROM flows WHERE id = $1', [id]);
      return row?.definition;
    },

    saveFlow: (flow: FlowDefinition) => saveFlow(flow),

    async deleteFlow(id: string): Promise<boolean> {
      return (await db.query('DELETE FROM flows WHERE id = $1 RETURNING id', [id])).length > 0;
    },

    /**
     * Brings in projects and flows that only exist elsewhere (the browser's localStorage, before the database):
     * whatever already exists in the database wins. A flow whose project is missing goes to the examples one.
     */
    async importWorkspace(projects: Project[], flows: FlowDefinition[]): Promise<{projects: number; flows: number}> {
      return db.transaction(async tx => {
        const existing = new Set((await tx.query<{id: string}>('SELECT id FROM projects')).map(r => r.id));
        const newProjects = projects.filter(p => !existing.has(p.id));
        for (const project of newProjects) {
          await saveProject(project, tx);
          existing.add(project.id);
        }
        const existingFlows = new Set((await tx.query<{id: string}>('SELECT id FROM flows')).map(r => r.id));
        const newFlows = flows.filter(f => !existingFlows.has(f.id))
          .map(f => (existing.has(f.projectId) ? f : {...f, projectId: 'examples'}));
        for (const flow of newFlows) await saveFlow(flow, tx);
        return {projects: newProjects.length, flows: newFlows.length};
      });
    },

    async saveRun(record: StoredRun) {
      await db.query(
        `INSERT INTO runs (id, project_id, workflow_id, mode, status, started_at, duration_ms, record) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text::jsonb)
         ON CONFLICT (id) DO UPDATE SET status = excluded.status, duration_ms = excluded.duration_ms, record = excluded.record`,
        [record.run.id, record.projectId ?? null, record.workflowId ?? null, record.run.mode, record.status, record.run.startedAt,
          Math.round(record.durationMs), JSON.stringify(record)],
      );
    },

    /** the latest runs (of a project), without the per-component detail */
    async listRuns(projectId: string | undefined, limit: number): Promise<Omit<StoredRun, 'components'>[]> {
      const rows = await db.query<{summary: Omit<StoredRun, 'components'>}>(
        `SELECT record - 'components' AS summary FROM runs WHERE ($1::text IS NULL OR project_id = $1)
         ORDER BY started_at DESC LIMIT $2`,
        [projectId ?? null, limit],
      );
      return rows.map(r => r.summary);
    },

    async getRun(id: string): Promise<StoredRun | undefined> {
      const [row] = await db.query<{record: StoredRun}>('SELECT record FROM runs WHERE id = $1', [id]);
      return row?.record;
    },
  };
}

export type Repository = ReturnType<typeof repository>;
