# dataflow — visual data flows, envelope by envelope (all in JavaScript)

Overview, concepts and how to run: [README.md](README.md). Engine architecture: [docs/architecture.md](docs/architecture.md).

| Folder | What it is | Details |
|---|---|---|
| `editor/` | App (Vite + React + React Flow) at the root: projects → flows (editor), runs, secrets, files | see [editor/CLAUDE.md](editor/CLAUDE.md) |
| `core/` | TypeScript engine without React or Node: contract (`src/types/`, one type per file, imported as `#types/<name>.type`), `src/envelope/` (building envelopes, expression variables), `src/validation/` (key names, cycles), `src/errors/`, `src/engine/` (envelope-by-envelope execution: entry point `workflowRunner` (`workflow-runner.ts`) → class `WorkflowExecution`), components (logic) | used by the editor (alias `@dataflow/core`) and by the runner |
| `runner/` | Runner in Bun + Hono (port 5190): projects, flows and execution runs in Postgres (editor test runs stay in the browser's IndexedDB) (`src/storage/`: `DATABASE_URL`, or PGlite in `runner/data.local/` without it), secrets and files per project, expressions and scripts in `node:vm` | runs separately; the editor talks to it through `/api` |

## Commands (at the root)

- Requirements: Node.js 24+ (`.nvmrc`, `engines` and `engine-strict=true` in every `.npmrc`) and Bun 1.2+. `npm run check` (`scripts/check-env.mjs`) checks both; it also runs before `setup` and `start`.
- `npm run setup` — installs the dependencies of the three parts (once).
- `npm run start` — starts **runner and editor together** (`scripts/dev-runner.mjs --with-editor`, one terminal); opens at http://localhost:5180/ (project list). Not `bun --watch` nor `concurrently`: both stop the runner with an immediate kill (see Database).
- `npm run lint` — ESLint over the three parts (`eslint.config.mjs`); it is the first step of `npm run build`, so a missing `;` or an `any` breaks the build.
- `npm test` — core and runner tests (`bun test`). Tests live in each part's `tests/` folder (never next to the code), mirroring `src/`: `core/tests/components/`, `core/tests/engine/`, `core/tests/validation/`, `runner/tests/`. `npm run typecheck` — the three parts. `npm run build` — editor build.
- Each part has an `.npmrc` pointing to the public npm registry, so it installs the same even with another registry configured on the machine.

## New component

1. Logic in `core/src/components/<name>.ts` (`validate` and `execute`) and registration in `core/src/components/index.ts`.
   - If the component accumulates envelopes, report it with `ctx.holding(count, envelope)` (it becomes the Memory in the Metrics). An internal wait that is not an input (its own promise, an internal queue) goes through `ctx.wait` / `ctx.waitEach`, so it does not count as active time.
2. Tests in `core/tests/components/<name>.test.ts` (they run the component inside a workflow, with `evaluate` and `mapperFlow` from `core/tests/helpers.ts`); engine behavior that is not a component's (errors, flow order, metrics) goes in `core/tests/engine/`.
3. Visual part in `editor/src/components/<name>.tsx` (`Card`, `Panel`, `Docs`) and an entry in the `PALETTE` (`editor/src/components/catalog.ts`).
4. The runner does not need to change, except for a component that talks to the outside. A new database: add its name to `DatabaseKind` (`core/src/types/database-kind.type.ts`), write the driver in `runner/src/databases/<name>.ts` and register it in `databases` (`runner/src/index.ts`); the component calls `ctx.queryDatabase('<kind>', ...)` and keeps its SQL-flavor rules. A database that is written to (a target, e.g. MongoDB): its name goes in `DocumentStoreKind`, the driver (`UpsertDocuments`) in `runner/src/databases/<name>.ts`, created per run in `documentStores` (`runner/src/index.ts`, closed when the run ends), and the component calls `ctx.upsertDocuments('<kind>', ...)`; reading from it (a source, e.g. MongoDB Pipeline) goes through `documentQueries` (`AggregateDocuments`) and `ctx.aggregateDocuments('<kind>', ...)`; deleting, through `documentDeletes` (`DeleteDocuments`) and `ctx.deleteDocuments('<kind>', ...)`, which in a test run only counts.
   - A component that writes outside the flow declares `sideEffects: true`: in the editor's Run (`validation`) the engine sends none of its writes and its branch stops there; it writes only in Run for real (`execution`). See section 12 of `docs/architecture.md`.
   - `npm run start` restarts the runner when `runner/src` or `core/src` changes (see Database).

## Database

**Never stop the local database in the middle of a write.** PGlite (`runner/data.local/`) stopped abruptly can become unreadable (it happened with `bun --watch`, which kills the runner on every change; `concurrently` and tree-kill do the same on Windows, `taskkill /F`). So in dev the runner runs under `scripts/dev-runner.mjs`, which also starts the editor with `--with-editor`: it watches only `runner/src` and `core/src`, asks the runner to stop through its stdin (Windows has no signals between processes), waits for it to close the database and only then starts it again, one restart at a time. On Ctrl+C / Ctrl+Break / SIGTERM it does the same and then closes the editor. The runner is started detached (on Windows a normal child dies at once with its parent), and closes the database on SIGINT/SIGTERM, on that stop line and when its stdin closes (the watcher went away, even killed): the database first, then the log. Stop it with Ctrl+C in its terminal; killing the watcher is safe too, killing the bun process is not. Check a stop with PGlite's log on the next open: "database system was shut down" is clean, "was interrupted" is not. **One process at a time**: opening the folder takes `runner/data.local.lock` (PID and start time, `runner/src/storage/lock.ts`); another live process holding it is an error that names its PID, a lock left by a process that is gone is taken over, and the clean close removes it (not used with `DATABASE_URL`). The watcher takes `runner/data.local.watcher.lock` the same way, so a second `npm run start` stops at once. Never open the database files while the runner is up: inspect through the runner's API, or stop it and open through `openDatabase` (which takes the lock). On every start it writes `runner/data.local.backup.json` (projects and flows; the one before stays as `.previous`). A broken folder can usually be read back on a copy with `pg_resetwal` (PostgreSQL 18, e.g. the `postgres` Docker image). For data that matters, use a real Postgres (`DATABASE_URL`, `docker compose up -d`).

`runner/src/storage/`: `database.ts` opens Postgres (`DATABASE_URL`, through `Bun.sql`) or PGlite (embedded, in `runner/data.local/`; `memory://` in the tests) behind the same `query`; `migrations.ts` holds the schema as numbered steps (never edit a committed step: add a new one at the end); `repository.ts` reads and writes; `routes.ts` is the projects and flows API. The flow is stored as the editor's lean definition in a `jsonb` column. Repository tests run on PGlite; with `TEST_DATABASE_URL` they also run on a real Postgres (and drop its tables first).

## Secrets (`$SECRETS`) and files

For now they live in the runner, outside git: `runner/secrets.local.json` (text at the top level = shared by every project; a project's own in `"projects": {"<id>": {"NAME": "value"}}`, read on each run) and `runner/files.local/<projectId>/`. The project's Secrets tab writes to the file through the runner and never reads the values back. They are available as `$SECRETS` in expressions, in the TypeScript component and in the SQL Server Query connection.

## Conventions

- Everything in English: code, identifiers, file names, UI text, comments and docs.
- No explanatory text inside the windows and cards: only short labels. Explanations go in the Notes tab (the component's `Docs`).
- Smallest text on screen: `text-sm`.
- Imports with `#` (subpath imports in the part's package.json): in the editor every folder (`#types/...`, `#components/catalog`...), never relative; in the core the folders `#types`, `#envelope`, `#validation`, `#errors` and `#engine` (e.g. `#types/envelope.type`, `#errors/normalize-error`).
- Semicolon at the end of every statement and type member; never the `any` type (use `unknown`, generics or the real type). Both are lint errors and fail the build.

## Commits

- Commit messages must NEVER contain `Co-Authored-By:` or `Claude-Session:` lines.
