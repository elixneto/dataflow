# Architecture

How the engine works inside. To run and use it, see the [README](../README.md).

## 1. Pieces

| Piece | Where | What it does |
|---|---|---|
| **core** | `core/` | The component contract, the envelope, the logic of each component and the engine that runs a flow envelope by envelope. Plain TypeScript: no React, no Node. |
| **runner** | `runner/` | A Bun + Hono app. Receives the flow, runs it with the core and provides what the core does not do on its own: evaluating expressions and scripts in a sandbox (`node:vm`), talking to databases (SQL Server), reading the project's secrets and files, and storing projects, flows and runs in Postgres. |
| **editor** | `editor/` | A React app: projects, folders, the visual editor (React Flow), each component's window and the run results. Uses the core to validate the assembly and calls the runner to run. |

## 2. Concepts

| Concept | What it is |
|---|---|
| **Project** | Groups flows (in folders), secrets and files. |
| **Flow** (workflow) | A Start, an End and components in between, connected by ports. Declares the **parameters** it expects, each with a default value. |
| **Run** | One round of a flow, with the record per component. |
| **Component** | A palette piece: ports, configuration (with expressions) and the `execute` function. |
| **Envelope** | What goes from one component to another. |

## 3. The envelope

```json
{
  "WORKFLOW_CURRENT_RUN": {"id": "…", "mode": "execution", "project": "Sales", "workflow": "Today's invoices", "startedAt": "2026-10-21T12:34:56Z"},
  "PARAMETERS": {"since": "2026-10-01"},
  "DATA": {"customer": {"id": 71, "name": "Good Price Market"}}
}
```

1. **The Start always emits one envelope**, with `WORKFLOW_CURRENT_RUN`, `PARAMETERS` and an empty `DATA`. With "Accepts input", the call's input becomes the `DATA` (a list: one envelope per item).
2. **Each component adds to `DATA`**: under its own key (e.g. `$result` of the TypeScript, `$lookup` of the Lookup) or directly in the fields (Mapper, Data Grid, SQL Server Query).
3. **Override** (on each component that produces data): the output carries only what it produced and drops the rest of `DATA`.
4. **One makes many**: a component that emits N envelopes from 1 (Data Grid, SQL Server Query) copies the incoming envelope into each one.
5. An envelope that goes out through the **error port** gets `DATA.errors`: a list of `{error, message, component}`, which grows if it fails in more than one component.

## 4. Expressions

- `$WORKFLOW_CURRENT_RUN.id`, `$PARAMETERS.since`, `$SECRETS.MY_SQL_DATABASE` and, directly, each key of `DATA`: `$customer.name`.
- Each field has the `=` button: off, the value is plain text; on, it is JavaScript evaluated in the runner, in a `node:vm` with a timeout and only these variables in sight.
- An expression that fails is an error of that envelope (it follows the "On error" policy), not of the whole run.

## 5. Ports

Every port receives and sends **envelopes**, in sequence: there is no port type, any output connects to any input.

- Each output connects to a single input (the End is the exception: it accepts several). To send the same envelope to several places, use **Copy**; to join paths, **Union**.
- Components that can fail per envelope have the **On error** policy: Stop (default), Continue (the envelope moves on as it came in) or Divert (it goes out through the error port).
- Cycles are not allowed (they would be an infinite loop of envelopes).

## 6. Pipeline and backpressure

- Each edge becomes an async queue (`Channel`) with limited capacity; all components run at the same time. Envelope 1 is already in the Filter while the query is still reading envelope 2.
- **Backpressure**: the writer waits when the queue is full, so memory stays constant whatever the volume. The SQL Server Query even pauses the database.
- **Accumulators** (Lookup, Aggregate, Sort) hold envelopes by nature and report how much they hold (it becomes the Memory in the Metrics); Distinct reports only the keys it has seen.

## 7. Component contract (core)

```ts
type ComponentLogic = {
  type: string
  inputs: number                                          // number of ports; all of them carry envelopes
  outputs: number
  optionalOutputs?: string[] | ((config) => string[])     // may stay unconnected (e.g. the Filter's false)
  variableInputs?: {min, max, key}                        // e.g. Union
  variableOutputs?: {min, max, key}                       // e.g. Copy
  defaultOutputKey?: string                               // key in DATA (the node can change it)
  validate(config): string[]                              // assembly, without data
  execute(inputs, config, ctx): AsyncIterable<{port, doc} | {error, doc}>
}
```

The `ctx` gives the component: `fieldValue` (text or expression), `log`, `prepareScript` (TypeScript), `queryDatabase(kind, ...)` (through the driver the runner registered for that database, e.g. `sqlserver`), `invokeWorkflow`, `wait`/`waitEach` (waits that do not count as active time) and `holding` (memory). Whatever talks to the outside (sandbox, database) is injected by the runner; the core only receives the function.

## 8. Run record

Per run: run, parameters, status (`completed`, `with-warnings`, `with-errors`, `failed`), duration and error. Per component: status, start and end, duration, **active time** (the time processing, without the waiting; since it is a single thread, it is practically its CPU), **estimated memory** (peak of envelopes held and bytes from the JSON), envelopes per port, logs, input and output samples (20 per port) and, in the Workflow Invoker, a summary of each called run.

The runner stores every run in the `runs` table (the full record in `jsonb`, with the project, flow, status and start beside it to list and filter); the list returns the latest 50. The next step is each run in its own Bun Worker, which isolates it and allows measuring CPU and RAM per run.

## 9. Workflow Invoker

Runs another flow per envelope, with the parameters of its Start. Whatever reaches the child's End goes out of the Invoker; a child failure is an error of the envelope (with Divert, the error port can call an error-handling flow). A circular call is blocked, the chain stops at 10 levels, and stopping the run stops the children. The child receives `WORKFLOW_CURRENT_RUN.parentId`.

## 10. Read only in the SQL Server Query

Three layers: the query must be a single statement, starting with `SELECT` or `WITH`, without words that write, execute or change the session (read left to right, like SQL Server: comments and strings do not fool it); it runs inside a transaction that is always rolled back; and the connection uses `ApplicationIntent=ReadOnly`. Even so, use a read-only login.

## 11. Runner API

All under `/api` (the editor's Vite dev server proxies it to the runner on port 5190). Errors come back as `{error}`.

| Route | What it does |
|---|---|
| `GET /api/health` | Health check (503 when the database does not answer); the editor polls it every 5 s |
| `GET /api/projects` / `GET /api/projects/:id` | Projects |
| `PUT` / `DELETE /api/projects/:id` | Creates or replaces / deletes a project (its flows go along) |
| `GET /api/flows?project=` / `GET /api/flows/:id` | Flows (lean definitions), optionally of one project |
| `PUT` / `DELETE /api/flows/:id` | Creates or replaces / deletes a flow |
| `POST /api/import` | `{projects, flows}` from before the database (the browser's localStorage); what already exists wins |
| `POST /api/runs` | Runs a flow: `{id?, workflow, mode, parameters?, input?, projectId?, workflows?}` → the run record |
| `POST /api/runs/:id/cancel` | Stops a run in progress (the Stop button) |
| `GET /api/runs?project=` | The latest runs (without the per-component detail), optionally of one project |
| `GET /api/runs/:id` | One run's full record |
| `GET /api/projects/:projectId/secrets` | Secret names: `[{name, source: 'project' \| 'shared'}]`; values never come back |
| `PUT /api/projects/:projectId/secrets/:name` | Saves a project secret: `{value}` |
| `DELETE /api/projects/:projectId/secrets/:name` | Deletes a project secret (shared ones stay in the file) |
| `GET /api/projects/:projectId/files` | Files: `[{name, size, updatedAt}]` |
| `POST /api/projects/:projectId/files` | Uploads a file (multipart, `file` field); the same name is replaced |
| `GET` / `DELETE /api/projects/:projectId/files/:name` | Downloads / deletes a file |

Environment variables: `DATABASE_URL` (Postgres; without it, PGlite in `runner/data.local/`), `RUNNER_PORT` (default 5190), `RUNNER_TIMEOUT_MS` (maximum time of a run, default 5 min) and `RUNNER_SCRIPT_TIMEOUT_MS` (maximum time of each TypeScript `process` call, default 30 s).

## 12. Targets in test runs (planned)

There are no targets yet (components that write outside: SQL insert, HTTP...), but the rule is decided, so nobody writes half-baked data by running a flow "just to see if it works" and forgetting to disable the target. The user should not have to write a fake output either: what comes after a target usually needs its real answer (a generated id, a response body).

- **A target declares itself**: `sideEffects: true` on its `ComponentLogic` (or a function of the config, e.g. an HTTP request is a target only for POST, PUT, PATCH and DELETE). Reading components (SQL Server Query, HTTP GET/HEAD) run normally in any mode.
- **Editor runs use `mode: 'validation'`** (the `RunMode` already exists, today nothing reads it). Triggers (endpoint, cron) always run in `execution`.
- **What a target does in `validation`**, in this order:
  1. **SQL**: writes inside a transaction that is always rolled back. The output is real (rows affected, `OUTPUT inserted.id`) and nothing stays.
  2. **Pinned output** (like n8n's pin data): every real run stores the target's last output per input sample; a test run replays it. The user can also pin an output by hand, but never has to.
  3. **Nothing to replay**: the target records what it would send (the statement with its parameters, the request) and stops the branch there; the components after it show as not run. No output is made up.
- **Running for real** is a separate action (`mode: 'execution'`) that asks for confirmation, listing the enabled targets that are going to write. In the test dialog, one target can be marked "run for real" on its own, with the same confirmation.
- **Optional, per target**: a test connection (a second secret used in `validation`, so it really writes, but to a staging database).
- The Disable button stays as it is: it bypasses a component in any mode.

## 13. Not done yet

- Secrets and files in the database / blob storage (today they live in runner folders).
- Triggers: an endpoint per flow and scheduling (cron).
- Authentication in the runner.
- Sources and targets beyond SQL Server (CSV, HTTP, other databases).

## 14. Suggested components

Ideas taken from n8n, not built yet (its Split Out, Remove Duplicates and Sort are our Split, Distinct and Sort; its Loop Over Items is our Aggregate).

| Component | What it does |
|---|---|
| **HTTP Request** | Calls an API per envelope (method, URL, headers, body as expressions, connection secret). Source with GET/HEAD; target with POST, PUT, PATCH and DELETE (follows section 12 in test runs). |
| **Limit** | Lets only the first N envelopes through and drops the rest; handy to test a flow on a sample. |
| **Compare Datasets** | Two inputs compared by key; outputs: only in A (new), only in B (removed), different, equal. For syncing two systems. |
| **Wait / Rate limit** | Waits a fixed time per envelope, or caps how many envelopes per second go through (APIs with quotas). |
| **Files (CSV, Excel, JSON)** | Reads a project file into one envelope per row (source) and writes the envelopes into a file (target). |
