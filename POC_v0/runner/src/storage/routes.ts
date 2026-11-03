import {Hono} from 'hono';
import type {FlowDefinition, Project, Repository} from './repository';

/*
 * Projects and flows API (the database). The editor loads everything when it opens and saves one item at a time.
 */

/** project id becomes a folder name in files.local and the secrets key: no "..", slash or odd characters */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function storageRoutes(repo: Repository) {
  const routes = new Hono();

  routes.get('/projects', async c => c.json(await repo.listProjects()));

  routes.get('/projects/:id', async c => {
    const project = await repo.getProject(c.req.param('id'));
    return project ? c.json(project) : c.json({error: 'Project not found.'}, 404);
  });

  /** creates or replaces the project */
  routes.put('/projects/:id', async c => {
    const id = c.req.param('id');
    if (!SAFE_ID.test(id)) return c.json({error: 'Invalid project id (letters, digits, - and _).'}, 400);
    const project = await c.req.json<Project>().catch(() => undefined);
    if (!project?.name?.trim()) return c.json({error: 'Enter the project name.'}, 400);
    await repo.saveProject({...project, id});
    return c.json({ok: true});
  });

  routes.delete('/projects/:id', async c =>
    (await repo.deleteProject(c.req.param('id'))) ? c.json({ok: true}) : c.json({error: 'Project not found.'}, 404));

  /** every flow (or a project's, with ?project=), as lean definitions */
  routes.get('/flows', async c => c.json(await repo.listFlows(c.req.query('project'))));

  routes.get('/flows/:id', async c => {
    const flow = await repo.getFlow(c.req.param('id'));
    return flow ? c.json(flow) : c.json({error: 'Flow not found.'}, 404);
  });

  /** creates or replaces the flow (the editor's lean definition) */
  routes.put('/flows/:id', async c => {
    const flow = await c.req.json<FlowDefinition>().catch(() => undefined);
    if (!flow?.name || !Array.isArray(flow.nodes)) return c.json({error: 'Invalid flow.'}, 400);
    if (!flow.projectId || !(await repo.getProject(flow.projectId))) return c.json({error: 'The flow\'s project does not exist.'}, 400);
    await repo.saveFlow({...flow, id: c.req.param('id')});
    return c.json({ok: true});
  });

  routes.delete('/flows/:id', async c =>
    (await repo.deleteFlow(c.req.param('id'))) ? c.json({ok: true}) : c.json({error: 'Flow not found.'}, 404));

  /** brings in what was in the browser before the database; what already exists wins */
  routes.post('/import', async c => {
    const body = await c.req.json<{projects?: Project[]; flows?: FlowDefinition[]}>().catch(() => undefined);
    const projects = (body?.projects ?? []).filter(p => SAFE_ID.test(p?.id ?? '') && p.name);
    const flows = (body?.flows ?? []).filter(f => f?.id && f.name && Array.isArray(f.nodes))
      .map(f => ({...f, projectId: f.projectId || 'examples'}));
    return c.json(await repo.importWorkspace(projects, flows));
  });

  return routes;
}
