import type { UseCaseContext } from '#shared/use-cases/use-case-context';

/** What the middlewares put on each Hono request: `c.get('useCase')` in a route. */
export type AppEnv = {
  Variables: {
    useCase: UseCaseContext;
  };
};
