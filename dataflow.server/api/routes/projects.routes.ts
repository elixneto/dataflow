import { Hono } from 'hono';
import { CreateFolderHandler } from '#features/folders/create-folder/create-folder-handler';
import { GetProjectContentsHandler } from '#features/folders/get-project-contents/get-project-contents-handler';
import { CreateFlowHandler } from '#features/flows/create-flow/create-flow-handler';
import { ArchiveProjectHandler } from '#features/projects/archive-project/archive-project-handler';
import { CreateProjectHandler } from '#features/projects/create-project/create-project-handler';
import { GetProjectHandler } from '#features/projects/get-project/get-project-handler';
import { ListProjectsHandler } from '#features/projects/list-projects/list-projects-handler';
import { RestoreProjectHandler } from '#features/projects/restore-project/restore-project-handler';
import { UpdateProjectHandler } from '#features/projects/update-project/update-project-handler';
import { toHttpResult } from '#shared/use-cases/to-http-result';
import type { AppEnv } from '../app-env';
import { bodyWith, jsonBody } from './request-input';

/** /projects (and a project's folders and flows): HTTP in, handler, HTTP out. No business rules here (like a controller in GRO.Server.Api). */
export function projectsRoutes() {
  return new Hono<AppEnv>()
    .get('/', async c => {
      const result = await new ListProjectsHandler().handle(c.req.query(), c.get('useCase'));
      return toHttpResult(c, result);
    })
    .post('/', async c => {
      const result = await new CreateProjectHandler().handle(await jsonBody(c), c.get('useCase'));
      return toHttpResult(c, result, 201);
    })
    .get('/:id', async c => {
      const result = await new GetProjectHandler().handle({ id: c.req.param('id') }, c.get('useCase'));
      return toHttpResult(c, result);
    })
    .patch('/:id', async c => {
      const result = await new UpdateProjectHandler().handle(await bodyWith(c, { id: c.req.param('id') }), c.get('useCase'));
      return toHttpResult(c, result);
    })
    .post('/:id/archive', async c => {
      const result = await new ArchiveProjectHandler().handle({ id: c.req.param('id') }, c.get('useCase'));
      return toHttpResult(c, result);
    })
    .post('/:id/restore', async c => {
      const result = await new RestoreProjectHandler().handle({ id: c.req.param('id') }, c.get('useCase'));
      return toHttpResult(c, result);
    })
    .get('/:id/contents', async c => {
      const result = await new GetProjectContentsHandler().handle({ projectId: c.req.param('id') }, c.get('useCase'));
      return toHttpResult(c, result);
    })
    .post('/:id/folders', async c => {
      const result = await new CreateFolderHandler().handle(await bodyWith(c, { projectId: c.req.param('id') }), c.get('useCase'));
      return toHttpResult(c, result, 201);
    })
    .post('/:id/flows', async c => {
      const result = await new CreateFlowHandler().handle(await bodyWith(c, { projectId: c.req.param('id') }), c.get('useCase'));
      return toHttpResult(c, result, 201);
    });
}
