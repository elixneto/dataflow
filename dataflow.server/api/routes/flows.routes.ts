import { Hono } from 'hono';
import { ArchiveFlowHandler } from '#features/flows/archive-flow/archive-flow-handler';
import { GetDraftHandler } from '#features/flows/get-draft/get-draft-handler';
import { GetFlowHandler } from '#features/flows/get-flow/get-flow-handler';
import { MoveFlowHandler } from '#features/flows/move-flow/move-flow-handler';
import { RenameFlowHandler } from '#features/flows/rename-flow/rename-flow-handler';
import { RestoreFlowHandler } from '#features/flows/restore-flow/restore-flow-handler';
import { SaveDraftHandler } from '#features/flows/save-draft/save-draft-handler';
import { toHttpResult } from '#shared/use-cases/to-http-result';
import type { AppEnv } from '../app-env';
import { bodyWith } from './request-input';

/** /flows/:id (listing and creating are under /projects/:id): HTTP in, handler, HTTP out. */
export function flowsRoutes() {
  return new Hono<AppEnv>()
    .get('/:id', async c => {
      const result = await new GetFlowHandler().handle({ id: c.req.param('id') }, c.get('useCase'));
      return toHttpResult(c, result);
    })
    .patch('/:id', async c => {
      const result = await new RenameFlowHandler().handle(await bodyWith(c, { id: c.req.param('id') }), c.get('useCase'));
      return toHttpResult(c, result);
    })
    .post('/:id/move', async c => {
      const result = await new MoveFlowHandler().handle(await bodyWith(c, { id: c.req.param('id') }), c.get('useCase'));
      return toHttpResult(c, result);
    })
    .post('/:id/archive', async c => {
      const result = await new ArchiveFlowHandler().handle({ id: c.req.param('id') }, c.get('useCase'));
      return toHttpResult(c, result);
    })
    .post('/:id/restore', async c => {
      const result = await new RestoreFlowHandler().handle({ id: c.req.param('id') }, c.get('useCase'));
      return toHttpResult(c, result);
    })
    .get('/:id/draft', async c => {
      const result = await new GetDraftHandler().handle({ id: c.req.param('id') }, c.get('useCase'));
      return toHttpResult(c, result);
    })
    .put('/:id/draft', async c => {
      const result = await new SaveDraftHandler().handle(await bodyWith(c, { id: c.req.param('id') }), c.get('useCase'));
      return toHttpResult(c, result);
    });
}
