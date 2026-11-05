import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { ArchiveFlowHandler } from '#features/flows/archive-flow/archive-flow-handler';
import { GetDraftHandler } from '#features/flows/get-draft/get-draft-handler';
import { GetFlowHandler } from '#features/flows/get-flow/get-flow-handler';
import { MoveFlowHandler } from '#features/flows/move-flow/move-flow-handler';
import { RenameFlowHandler } from '#features/flows/rename-flow/rename-flow-handler';
import { RestoreFlowHandler } from '#features/flows/restore-flow/restore-flow-handler';
import { SaveDraftHandler } from '#features/flows/save-draft/save-draft-handler';
import { CancelRunHandler } from '#features/runs/cancel-run/cancel-run-handler';
import { GetRunHandler } from '#features/runs/get-run/get-run-handler';
import { LastRunHandler } from '#features/runs/last-run/last-run-handler';
import { StartRunHandler } from '#features/runs/start-run/start-run-handler';
import type { RunProgress, RunRecord } from '@dataflow/core';
import { runEvents, type RunEvent } from '#features/runs/run-events';
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
    // what the editor shows of the flow's runs when it opens: its latest run that ended, and the full test run
    .get('/:id/last-run', async c => toHttpResult(c, await new LastRunHandler().handle({ id: c.req.param('id') }, c.get('useCase'))))
    .put('/:id/draft', async c => {
      const result = await new SaveDraftHandler().handle(await bodyWith(c, { id: c.req.param('id') }), c.get('useCase'));
      return toHttpResult(c, result);
    })
    // the editor's Run and Run for real: queued, its id right away; GET /runs/:id follows it
    .post('/:id/runs', async c => {
      const result = await new StartRunHandler().handle(await bodyWith(c, { id: c.req.param('id') }), c.get('useCase'));
      return toHttpResult(c, result, 202);
    });
}

/** /runs/:id: a run's status, and its record once it ended; Stop */
export function runsRoutes() {
  return new Hono<AppEnv>()
    .get('/:id', async c => {
      const result = await new GetRunHandler().handle({ id: c.req.param('id') }, c.get('useCase'));
      return toHttpResult(c, result);
    })
    // Stop
    .post('/:id/cancel', async c => {
      const result = await new CancelRunHandler().handle({ id: c.req.param('id') }, c.get('useCase'));
      return toHttpResult(c, result);
    })
    // the run as it goes (SSE): "progress" (the run so far, the latest first) a few times a second, then "usage" (what
    // its worker used, when known) and "done" (its record) and the end of the stream; a run that already ended answers
    // them right away
    .get('/:id/events', async c => {
      const result = await new GetRunHandler().handle({ id: c.req.param('id') }, c.get('useCase'));
      if (!result.ok) {
        return toHttpResult(c, result);
      }

      const run = result.value;
      return streamSSE(c, async stream => {
        // "done" comes after "usage" (what its worker used), when there is one
        const send = async (event: RunEvent) => {
          if (event.type === 'done' && event.usage) {
            await stream.writeSSE({ event: 'usage', data: JSON.stringify(event.usage) });
          }

          await stream.writeSSE({ event: event.type, data: JSON.stringify(event.type === 'progress' ? event.progress : event.record) });
        };
        if (run.status !== 'running' && run.status !== 'queued') {
          await send({ type: 'done', record: run.record as RunRecord, usage: run.usage });
          return;
        }

        let resolveDone: () => void = () => {};
        const done = new Promise<void>(resolve => (resolveDone = resolve));
        // events written in order; the stream ends once "done" is written
        let writing = Promise.resolve();
        const stop = runEvents.subscribe(run.id, event => {
          writing = writing.then(() => send(event));
          if (event.type === 'done') {
            void writing.finally(resolveDone);
          }
        });
        stream.onAbort(() => {
          stop();
          resolveDone();
        });
        // it may have ended between the read above and the subscription: then its record now
        const again = await new GetRunHandler().handle({ id: run.id }, c.get('useCase'));
        if (again.ok && again.value.status !== 'running' && again.value.status !== 'queued') {
          stop();
          await send({ type: 'done', record: again.value.record as RunRecord, usage: again.value.usage });
          return;
        }

        // the run so far, when it already started
        if (again.ok && again.value.status === 'running' && again.value.record) {
          writing = writing.then(() => send({ type: 'progress', progress: again.value.record as RunProgress }));
        }

        await done;
        stop();
      });
    });
}
