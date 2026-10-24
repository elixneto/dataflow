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

The editor's dev server proxies `/api` to `RUNNER_URL` (default http://localhost:5190).

### Troubleshooting

- **`Unsupported engine` / `Node.js 24.0+ is required`**: switch Node with `nvm use` (or install 24) and run `npm run setup` again.
- **`Bun is not installed`**: install Bun and open a new terminal, so the `PATH` is updated.
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
