# dataflow — visual data flows, envelope by envelope (all in JavaScript)

Overview, concepts and how to run: [README.md](README.md). Engine architecture: [docs/architecture.md](docs/architecture.md).

| Folder | What it is | Details |
|---|---|---|
| `editor/` | App (Vite + React + React Flow) at the root: projects → flows (editor), runs, secrets, files | see [editor/CLAUDE.md](editor/CLAUDE.md) |
| `core/` | TypeScript engine without React or Node: contract (`src/types/`, one type per file, imported as `#types/<name>.type`), `src/envelope/` (building envelopes, expression variables), `src/validation/` (key names, cycles), `src/errors/`, `src/engine/` (envelope-by-envelope execution: entry point `workflowRunner` (`workflow-runner.ts`) → class `WorkflowExecution`), components (logic) | used by the editor (alias `@dataflow/core`) and by the runner |
| `runner/` | Runner in Bun + Hono (port 5190): projects, flows and runs in Postgres (`src/storage/`: `DATABASE_URL`, or PGlite in `runner/data.local/` without it), secrets and files per project, expressions and scripts in `node:vm` | runs separately; the editor talks to it through `/api` |

## Commands (at the root)

- Requirements: Node.js 24+ (`.nvmrc`, `engines` and `engine-strict=true` in every `.npmrc`) and Bun 1.2+. `npm run check` (`scripts/check-env.mjs`) checks both; it also runs before `setup` and `start`.
- `npm run setup` — installs the dependencies of the three parts (once).
- `npm run start` — starts **runner and editor together** (concurrently, one terminal); opens at http://localhost:5180/ (project list).
- `npm run lint` — ESLint over the three parts (`eslint.config.mjs`); it is the first step of `npm run build`, so a missing `;` or an `any` breaks the build.
- `npm test` — core and runner tests (`bun test`). Tests live in each part's `tests/` folder (never next to the code), mirroring `src/`: `core/tests/components/`, `core/tests/engine/`, `core/tests/validation/`, `runner/tests/`. `npm run typecheck` — the three parts. `npm run build` — editor build.
- Each part has an `.npmrc` pointing to the public npm registry, so it installs the same even with another registry configured on the machine.

## New component

1. Logic in `core/src/components/<name>.ts` (`validate` and `execute`) and registration in `core/src/components/index.ts`.
   - If the component accumulates envelopes, report it with `ctx.holding(count, envelope)` (it becomes the Memory in the Metrics). An internal wait that is not an input (its own promise, an internal queue) goes through `ctx.wait` / `ctx.waitEach`, so it does not count as active time.
2. Tests in `core/tests/components/<name>.test.ts` (they run the component inside a workflow, with `evaluate` and `mapperFlow` from `core/tests/helpers.ts`); engine behavior that is not a component's (errors, flow order, metrics) goes in `core/tests/engine/`.
3. Visual part in `editor/src/components/<name>.tsx` (`Card`, `Panel`, `Docs`) and an entry in the `PALETTE` (`editor/src/components/catalog.ts`).
4. The runner does not need to change, except for a component that talks to the outside. A new database: add its name to `DatabaseKind` (`core/src/types/database-kind.type.ts`), write the driver in `runner/src/databases/<name>.ts` and register it in `databases` (`runner/src/index.ts`); the component calls `ctx.queryDatabase('<kind>', ...)` and keeps its SQL-flavor rules. `npm run start` runs Bun from the root, so `--watch` also reloads the runner when `core` changes.

## Database

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
