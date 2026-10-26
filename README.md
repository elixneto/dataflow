# dataflow

Visual data flows, **envelope by envelope**. You build the flow by connecting components on a canvas (read from a database, filter, join, transform with code, call another flow) and the runner executes it as a pipeline: each envelope goes from component to component until it reaches the End, with backpressure, per-envelope error handling and per-component metrics.

Inspired by SnapLogic and Pentaho Kettle, all in JavaScript: the editor in React, the engine in TypeScript and the runner in Bun.

> Status: working prototype. Projects, flows and runs live in the runner's database (Postgres); secrets and files, in runner folders on your machine. See [what is not done yet](docs/architecture.md#12-not-done-yet).

## Components

| Section | Component | What it does |
|---|---|---|
| Databases | **SQL Server Query** | Read-only, streamed query, with `@name` parameters |
| | **MongoDB Pipeline** | Read-only, streamed aggregation pipeline, written as in Compass, with expression values |
| | **MongoDB Delete** | Deletes the documents that match a filter (an empty one only with Delete all); counts only in a test run |
| | **MongoDB Upsert** | Updates or inserts each envelope into a collection (by filter fields); writes only in Run for real |
| APIs | **HTTP Request** | One request per envelope (method, URL, query, headers, body as expressions); answer in `$response`; a GET runs in a test run, POST/PUT/PATCH/DELETE only for real |
| Scripting | **TypeScript** | `async function process($input)` per envelope, in a sandbox |
| Transformation | **Mapper** | Writes fields into the envelope (text or expression) |
| | **Data Grid** | A typed table (or pasted from Excel) that emits one envelope per row |
| | **Filter** | Splits into `true` and `false` by a condition |
| | **Router** | Sends each envelope to the first true case |
| | **Lookup** | Finds the match in another input by key |
| | **Union** / **Copy** | Joins paths / sends the same envelope to several |
| | **Aggregate** / **Split** | Groups envelopes into batches / yields one envelope per item of a list |
| | **Distinct** | Lets through only the first envelope of each key |
| | **Sort** | Sorts the envelopes by keys |
| | **Limit** | Lets only the first (top) or last (bottom) N envelopes through |
| Flow | **Log** | Records a message per envelope (debug, info, warn, error); debug only in test runs |
| | **Workflow Invoker** | Calls another flow, passing the parameters of its Start |

Each component has its full explanation in the **Notes** tab of its window, inside the editor.

## Running

### Requirements

- [Node.js](https://nodejs.org) **24+** (the version is in `.nvmrc`; with [nvm](https://github.com/nvm-sh/nvm) or [nvm-windows](https://github.com/coreybutler/nvm-windows): `nvm install 24 && nvm use 24`).
- [Bun](https://bun.sh) **1.2+** (runs the runner and the tests). macOS/Linux: `curl -fsSL https://bun.sh/install | bash`; Windows: `powershell -c "irm bun.sh/install.ps1 | iex"`.
- Git.

`npm run check` confirms both versions. It also runs at the start of `npm run setup` and `npm run start`, and every `.npmrc` has `engine-strict=true`, so an older Node stops with a clear message instead of failing halfway.

### First time

```bash
git clone https://github.com/elixneto/dataflow.git
cd dataflow
npm run setup   # checks the environment and installs the dependencies of the three parts
npm run start   # runner (port 5190) + editor (port 5180), in one terminal
```

Open http://localhost:5180. The **Examples** project has an example flow for each component; open one and click **Run**.

After a `git pull` that changes a `package.json`, run `npm run setup` again.

### Configuration

The runner reads these environment variables (Bun also loads a `.env` file at the root, if there is one):

| Variable | Default | What it is |
|---|---|---|
| `RUNNER_PORT` | `5190` | Runner port |
| `RUNNER_TIMEOUT_MS` | `300000` (5 min) | Maximum time of a run |
| `RUNNER_SCRIPT_TIMEOUT_MS` | `30000` (30 s) | Maximum time of each TypeScript call |
| `DATABASE_URL` | (none: PGlite) | Postgres for projects, flows and runs, e.g. `postgres://dataflow:dataflow@localhost:5432/dataflow` |

The editor's dev server proxies `/api` to `RUNNER_URL` (default http://localhost:5190).

### Database

Projects, flows and runs are stored in Postgres. **Nothing to install to develop**: without `DATABASE_URL`, the runner uses [PGlite](https://pglite.dev) (Postgres compiled to WebAssembly) and writes to `runner/data.local/`, outside git. The schema is created and updated on its own when the runner starts (`runner/src/storage/migrations.ts`).

For a real Postgres (shared, or closer to production), start one with `docker compose up -d` (the `docker-compose.yml` at the root) or use your own, and put the address in a `.env` at the root:

```bash
DATABASE_URL=postgres://dataflow:dataflow@localhost:5432/dataflow
```

The first time the editor opens, whatever this browser had saved before the database (projects and flows in localStorage) is copied to the runner; what the database already has wins.

### Troubleshooting

- **`Unsupported engine` / `Node.js 24.0+ is required`**: switch Node with `nvm use` (or install 24) and run `npm run setup` again.
- **`Bun is not installed`**: install Bun and open a new terminal, so the `PATH` is updated.
- **The editor shows "The runner did not respond"**: projects and flows come from the runner, so it must be running (`npm run start` starts both). Check its terminal for a database error (a wrong `DATABASE_URL`, Postgres not started).
- **Start over with an empty local database**: stop the runner (Ctrl+C) and move `runner/data.local/` away. Each start leaves a copy of the projects and flows in `runner/data.local.backup.json`.
- **Port already in use**: something is still running on 5180 or 5190; stop it, or start with another `RUNNER_PORT` (and the same `RUNNER_URL` for the editor).

### Other commands

`npm test` (core and runner tests), `npm run lint`, `npm run typecheck`, `npm run build` (lint + editor build in `editor/dist`). CI runs the same steps on every pull request.

### Secrets and files

Each project has the **Secrets** and **Files** tabs. Secrets live in `runner/secrets.local.json` and files in `runner/files.local/`, both outside git. The screen saves the secret through the runner and never reads the value back. In the components, use `$SECRETS.NAME`.

A secret shared by every project can go directly at the top of the file:

```json
{
  "MY_SQL_DATABASE": "Server=localhost;Database=erp;User Id=reader;Password=...;Encrypt=true;TrustServerCertificate=true",
  "projects": {
    "examples": {"API_TOKEN": "..."}
  }
}
```

### Security

The runner executes code written in the editor (expressions and the TypeScript component) in a `node:vm`, which separates the scope but **is not a security boundary**, and it has no authentication yet. Run it only on your machine or on a trusted network.

## Structure

| Folder | What it is |
|---|---|
| `core/` | Engine: contract, envelope, components (logic) and execution. No React, no Node. |
| `runner/` | Runner in Bun + Hono: projects, flows and runs API (Postgres, or PGlite without `DATABASE_URL`), secrets and files; expressions and scripts sandbox; SQL Server driver. |
| `editor/` | React app: projects, folders, visual editor, component windows and run results. |
| `docs/` | [Architecture](docs/architecture.md) |

## Showcase examples

The examples project has a **Showcase** folder with two flows that use every component together. Both run as they are with the editor's **Run**, with no database, secret or network: the components that read from outside are pinned with sample data, and the ones that write send nothing in a test run.

- **Showcase: daily order sync**: ERP order lines (SQL Server) are deduplicated, filtered, joined to a customer mapping (Data Grid) and priced by tier. Unknown customers are looked up in a CRM (HTTP GET) and registered by a child flow (Workflow Invoker). TypeScript groups the lines into orders, which are sorted and then written to the CRM (MongoDB Upsert), split into pick lines joined to the product catalog (MongoDB Pipeline) and posted to the warehouse in batches (HTTP POST). Old picks are cleared (MongoDB Delete) and the top orders are logged.
- **Showcase: supplier price sync**: a supplier's price list (HTTP GET) is split and deduplicated. Discontinued items are removed from the shop (MongoDB Delete), and the rest is joined to the published catalog, the category margins and the ERP stock. TypeScript reprices each item and a Router sends it on by the size of the change (new products are approved by a child flow). The results are saved to the catalog, published in batches (HTTP POST) and reported.

## Creating a component

1. The logic in `core/src/components/<name>.ts` (`validate` and `execute`), registered in `core/src/components/index.ts`.
2. The visual part in `editor/src/components/<name>.tsx` (card, window and Notes), in the `PALETTE` of `editor/src/components/catalog.ts`.
3. A test in `core/tests/components/<name>.test.ts` (engine behavior that is not a component's goes in `core/tests/engine/`) and an example flow in `editor/src/data/flows.ts`.

The contract details are in the [architecture](docs/architecture.md#7-component-contract-core).

## Working on this repository (people and AI agents)

- All work happens directly in the maintainer's local clone (`E:\GITHUB\dataflow`), on branch `v0`: edit the files there, run lint, typecheck and tests there, and commit and push from there.
- Never work in a separate copy (a cloud container, a sandbox or another clone) and never create branches or pull requests.

## License

[MIT](LICENSE)
