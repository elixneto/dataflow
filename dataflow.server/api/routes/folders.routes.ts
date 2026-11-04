import { Hono } from 'hono';
import { ArchiveFolderHandler } from '#features/folders/archive-folder/archive-folder-handler';
import { MoveFolderHandler } from '#features/folders/move-folder/move-folder-handler';
import { RenameFolderHandler } from '#features/folders/rename-folder/rename-folder-handler';
import { RestoreFolderHandler } from '#features/folders/restore-folder/restore-folder-handler';
import { toHttpResult } from '#shared/use-cases/to-http-result';
import type { AppEnv } from '../app-env';
import { bodyWith } from './request-input';

/** /folders/:id (creating is under /projects/:id/folders): HTTP in, handler, HTTP out. */
export function foldersRoutes() {
  return new Hono<AppEnv>()
    .patch('/:id', async c => {
      const result = await new RenameFolderHandler().handle(await bodyWith(c, { id: c.req.param('id') }), c.get('useCase'));
      return toHttpResult(c, result);
    })
    .post('/:id/move', async c => {
      const result = await new MoveFolderHandler().handle(await bodyWith(c, { id: c.req.param('id') }), c.get('useCase'));
      return toHttpResult(c, result);
    })
    .post('/:id/archive', async c => {
      const result = await new ArchiveFolderHandler().handle({ id: c.req.param('id') }, c.get('useCase'));
      return toHttpResult(c, result);
    })
    .post('/:id/restore', async c => {
      const result = await new RestoreFolderHandler().handle({ id: c.req.param('id') }, c.get('useCase'));
      return toHttpResult(c, result);
    });
}
