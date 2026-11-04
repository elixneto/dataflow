import { Hono } from 'hono';
import { CreateConnectionHandler } from '#features/connections/create-connection/create-connection-handler';
import { DeleteConnectionHandler } from '#features/connections/delete-connection/delete-connection-handler';
import { ListConnectionsHandler } from '#features/connections/list-connections/list-connections-handler';
import { TestConnectionDraftHandler } from '#features/connections/test-connection-draft/test-connection-draft-handler';
import { TestConnectionHandler } from '#features/connections/test-connection/test-connection-handler';
import { UpdateConnectionHandler } from '#features/connections/update-connection/update-connection-handler';
import { CreateSecretHandler } from '#features/secrets/create-secret/create-secret-handler';
import { DeleteSecretHandler } from '#features/secrets/delete-secret/delete-secret-handler';
import { ListSecretsHandler } from '#features/secrets/list-secrets/list-secrets-handler';
import { SetSecretValueHandler } from '#features/secrets/set-secret/set-secret-handler';
import { CreateVariableHandler } from '#features/variables/create-variable/create-variable-handler';
import { DeleteVariableHandler } from '#features/variables/delete-variable/delete-variable-handler';
import { ListVariablesHandler } from '#features/variables/list-variables/list-variables-handler';
import { UpdateVariableHandler } from '#features/variables/update-variable/update-variable-handler';
import { toHttpResult } from '#shared/use-cases/to-http-result';
import type { AppEnv } from '../app-env';
import { bodyWith } from './request-input';

/**
 * A project's secrets, variables and connections: listing and creating under /projects/:id/..., the rest under
 * /secrets/:id, /variables/:id, /connections/:id. HTTP in, handler, HTTP out.
 */
export function projectResourcesRoutes() {
  return new Hono<AppEnv>()
    .get('/projects/:id/secrets', async c => toHttpResult(c, await new ListSecretsHandler().handle({ projectId: c.req.param('id') }, c.get('useCase'))))
    .post('/projects/:id/secrets', async c =>
      toHttpResult(c, await new CreateSecretHandler().handle(await bodyWith(c, { projectId: c.req.param('id') }), c.get('useCase')), 201))
    .put('/secrets/:id/value', async c => toHttpResult(c, await new SetSecretValueHandler().handle(await bodyWith(c, { id: c.req.param('id') }), c.get('useCase'))))
    .delete('/secrets/:id', async c => toHttpResult(c, await new DeleteSecretHandler().handle({ id: c.req.param('id') }, c.get('useCase'))))

    .get('/projects/:id/variables', async c => toHttpResult(c, await new ListVariablesHandler().handle({ projectId: c.req.param('id') }, c.get('useCase'))))
    .post('/projects/:id/variables', async c =>
      toHttpResult(c, await new CreateVariableHandler().handle(await bodyWith(c, { projectId: c.req.param('id') }), c.get('useCase')), 201))
    .patch('/variables/:id', async c => toHttpResult(c, await new UpdateVariableHandler().handle(await bodyWith(c, { id: c.req.param('id') }), c.get('useCase'))))
    .delete('/variables/:id', async c => toHttpResult(c, await new DeleteVariableHandler().handle({ id: c.req.param('id') }, c.get('useCase'))))

    .get('/projects/:id/connections', async c =>
      toHttpResult(c, await new ListConnectionsHandler().handle({ projectId: c.req.param('id') }, c.get('useCase'))))
    .post('/projects/:id/connections', async c =>
      toHttpResult(c, await new CreateConnectionHandler().handle(await bodyWith(c, { projectId: c.req.param('id') }), c.get('useCase')), 201))
    .post('/projects/:id/connections/test', async c =>
      toHttpResult(c, await new TestConnectionDraftHandler().handle(await bodyWith(c, { projectId: c.req.param('id') }), c.get('useCase'))))
    .put('/connections/:id', async c =>
      toHttpResult(c, await new UpdateConnectionHandler().handle(await bodyWith(c, { id: c.req.param('id') }), c.get('useCase'))))
    .delete('/connections/:id', async c => toHttpResult(c, await new DeleteConnectionHandler().handle({ id: c.req.param('id') }, c.get('useCase'))))
    .post('/connections/:id/test', async c => toHttpResult(c, await new TestConnectionHandler().handle({ id: c.req.param('id') }, c.get('useCase'))));
}
