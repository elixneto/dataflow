# The server's image: the api (api/server.ts) and the supervisor with its workers (supervisor/main.ts) run from it,
# each as its own container (docker-compose.yml, profile "server"). Built from the repository root (the workspace:
# dataflow.core is a dependency, read as TypeScript like in development).
#
#   docker compose --profile server build
FROM oven/bun:1.4.4-slim

WORKDIR /app
ENV NODE_ENV=production

# the dependencies first (cached while the manifests do not change): only the server's and the core's, no dev ones
COPY package.json bun.lock ./
COPY dataflow.core/package.json dataflow.core/
COPY dataflow.server/package.json dataflow.server/
COPY dataflow.editor/package.json dataflow.editor/
COPY dataflow.perf/package.json dataflow.perf/
RUN bun install --frozen-lockfile --production --filter '@dataflow/server'

# the code (.dockerignore keeps out node_modules, .env files, tests, the editor and the perf package)
COPY dataflow.core/src dataflow.core/src
COPY dataflow.server dataflow.server

# not root: the image's own user
USER bun
EXPOSE 5190

# the api; the supervisor's container runs dataflow.server/supervisor/main.ts instead
CMD ["bun", "dataflow.server/api/server.ts"]
