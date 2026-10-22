# dataflow

Visual data flows, **envelope by envelope**. You build the flow by connecting components on a canvas (read from a database, filter, join, transform with code, call another flow) and the runner executes it as a pipeline: each envelope goes from component to component until it reaches the End, with backpressure, per-envelope error handling and per-component metrics.

Inspired by SnapLogic and Pentaho Kettle, all in JavaScript: the editor in React, the engine in TypeScript and the runner in Bun.

> Status: working prototype. Projects and flows live in the browser (localStorage); runs, secrets and files live in the runner, on your machine. See [what is not done yet](docs/architecture.md#12-not-done-yet).

## Components

| Section | Component | What it does |
|---|---|---|
| Data Sources | **Data Grid** | A typed table (or pasted from Excel) that emits one envelope per row |
| | **SQL Server Query** | Read-only, streamed query, with `@name` parameters |
| Scripting | **TypeScript** | `async function process($input)` per envelope, in a sandbox |
| Transformation | **Mapper** | Writes fields into the envelope (text or expression) |
| | **Filter** | Splits into `true` and `false` by a condition |
| | **Router** | Sends each envelope to the first true case |
| | **Lookup** | Finds the match in another input by key |
| | **Union** / **Copy** | Joins paths / sends the same envelope to several |
| | **Aggregate** | Groups envelopes into batches |
| Flow | **Workflow Invoker** | Calls another flow, passing the parameters of its Start |

Each component has its full explanation in the **Notes** tab of its window, inside the editor.

## Running

Requires [Node.js](https://nodejs.org) 20.19+ (or 22.12+, for Vite 8) and [Bun](https://bun.sh) 1.2+.

```bash
npm run setup   # dependencies of the three parts (once)
npm run start   # runner (port 5190) + editor (port 5180)
```

Open http://localhost:5180. The **Examples** project has an example flow for each component; open one and click **Run**.

Other commands: `npm test` (core and runner tests), `npm run typecheck`, `npm run build` (editor build in `editor/dist`).

The runner reads `RUNNER_PORT` (default 5190), `RUNNER_TIMEOUT_MS` (maximum time of a run, default 5 min) and `RUNNER_SCRIPT_TIMEOUT_MS` (maximum time of each TypeScript call, default 30 s). The editor's dev server proxies `/api` to `RUNNER_URL` (default http://localhost:5190).

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
| `runner/` | Runner in Bun + Hono: runs, secrets and files API; expressions and scripts sandbox; SQL Server driver. |
| `editor/` | React app: projects, folders, visual editor, component windows and run results. |
| `docs/` | [Architecture](docs/architecture.md) |

## Creating a component

1. The logic in `core/src/components/<name>.ts` (`validate` and `execute`), registered in `core/src/components/index.ts`.
2. The visual part in `editor/src/components/<name>.tsx` (card, window and Notes), in the `PALETTE` of `editor/src/components/catalog.ts`.
3. A test in `core/src/engine/engine.test.ts` and an example flow in `editor/src/mock/flows.ts`.

The contract details are in the [architecture](docs/architecture.md#7-component-contract-core).

## License

[MIT](LICENSE)
