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

**Dates are Date**: a date column of the SQL Server Query or a date of the MongoDB Pipeline travels as a `Date`, never as text that looks like a date (whether a value is a date is its type: `isDate`, `core/src/envelope/dates.ts`, which also accepts a Date made in node:vm). Expressions can use it, Sort orders by time, Lookup and Distinct key it by its instant, the MongoDB Upsert writes it as a BSON date. The run's samples (Data tab) and the stored record show it as ISO text.

1. **The Start always emits one envelope**, with `WORKFLOW_CURRENT_RUN`, `PARAMETERS` and an empty `DATA`. With "Accepts input", the call's input becomes the `DATA` (a list: one envelope per item).
2. **Each component adds to `DATA`**: under its own key (e.g. `$result` of the TypeScript, `$lookup` of the Lookup) or directly in the fields (Mapper, Data Grid, SQL Server Query).
3. **Override** (on each component that produces data): the output carries only what it produced and drops the rest of `DATA`.
4. **One makes many**: a component that emits N envelopes from 1 (Data Grid, SQL Server Query, MongoDB Pipeline) copies the incoming envelope into each one.
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
- **Accumulators** (Lookup, Aggregate, Sort, Limit in bottom mode) hold envelopes by nature and report how much they hold (it becomes the Memory in the Metrics); Distinct reports only the keys it has seen.

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
  sideEffects?: boolean                                   // a target: writes outside (section 12)
  validate(config): string[]                              // assembly, without data
  execute(inputs, config, ctx): AsyncIterable<{port, doc} | {error, doc}>
}
```

The `ctx` gives the component: `fieldValue` (text or expression), `log`, `prepareScript` (TypeScript), `queryDatabase(kind, ...)` (through the driver the runner registered for that database, e.g. `sqlserver`), `aggregateDocuments(kind, ...)` (runs a read-only aggregation pipeline through a document database driver, e.g. `mongodb`, and yields the documents with backpressure), `upsertDocuments(kind, ...)` (writes a batch through a document database driver, e.g. `mongodb`; one result per document; in a test run it sends nothing and answers null), `invokeWorkflow`, `wait`/`waitEach` (waits that do not count as active time) and `holding` (memory). Whatever talks to the outside (sandbox, database) is injected by the runner; the core only receives the function.

## 8. Run record

Per run: run, parameters, status (`completed`, `with-warnings`, `with-errors`, `failed`), duration and error. Per component: status (also `pinned` and `not-run`, see below), start and end, duration (the time it was **open**: from its first envelope until it finished, that is, after the component before it closed the channel, its "all sent", and it sent its last result; components stream, so these overlap and do not add up to the run's total; the Metrics tab draws them on a timeline), **active time** (the time processing, without the waiting; since it is a single thread, it is practically its CPU), **waiting** (`waitingMs`: the time waiting for an outside system, measured by the context helpers that talk to it: pulling the next row from a database, a MongoDB write, the next envelope of a called workflow; not the waiting for envelopes nor for the next component, so a database held back by backpressure does not count), **estimated memory** (peak of envelopes held and bytes from the JSON), envelopes per port, logs, input and output samples (50 per port, `SAMPLE_SIZE`) and, in the Workflow Invoker, a summary of each called run.

The runner stores every **execution** run in the `runs` table (the full record in `jsonb`, with the project, flow, status and start beside it to list and filter); the list returns the latest 50. Editor test runs (`validation`) are not stored by the runner: the editor keeps, in this browser's IndexedDB (`editor/src/data/validation-runs.ts`), the latest result of each node that ran, one entry per flow for its current version (an entry of an older version is dropped). It is only the run's samples (at most 50 envelopes per port), not the full data, and only in that browser. The flow's `version` does not change on save (saving is a draft of the current version); only publishing (deploy, not built yet) will raise it. The next step is each run in its own Bun Worker, which isolates it and allows measuring CPU and RAM per run.

### Pinned output and "Run from here"

- **Pin** (like n8n's pin data): from the pin button on the card or the result's Data tab, a component's main output can be pinned. It is saved on the node (`pinned`: the DATA per output port; the editor pins `out-0`, up to the 50 of the sample) and goes to the runner in `ExecutableNode.pinned`. **Only in editor runs** (`mode: 'validation'`, which is what the editor's Run uses): the components before it run as usual, and the pinned node reads and drops its input, does not execute and sends the pinned envelopes out (status `pinned`, a pin on the card; clicking it unpins). A real run (`execution`) ignores the pin and executes the node, so a pin can never change what a production run does.
- **Run from here** (the play button on the card): runs (in `validation`) only that node and what comes after it. Each node outside that part with an edge into it is pinned for this run only with what it sent the last time it ran (`runFromWorkflow`, `editor/src/run/run-from.ts`); the other nodes are left out of the run. The editor keeps the latest result of every node that ran (`mergeLastRuns`), even after the result panel is minimized or the page is reloaded (IndexedDB, see above), and a partial run only replaces the nodes it ran; so after any run the play and pin buttons stay on every node with sample data, and are hidden only on nodes that never ran. Run from here shows only where every one of those feeding nodes ran without failing, so a node that failed can be fixed and run again from itself. It replays the samples, so at most 50 envelopes per port.

## 9. Workflow Invoker

Runs another flow per envelope, with the parameters of its Start. Whatever reaches the child's End goes out of the Invoker; a child failure is an error of the envelope (with Divert, the error port can call an error-handling flow). A circular call is blocked, the chain stops at 10 levels, and stopping the run stops the children. The child receives `WORKFLOW_CURRENT_RUN.parentId`.

## 10. Read only in the SQL Server Query

Three layers: the query must be a single statement, starting with `SELECT` or `WITH`, without words that write, execute or change the session (read left to right, like SQL Server: comments and strings do not fool it); it runs inside a transaction that is always rolled back; and the connection uses `ApplicationIntent=ReadOnly`. Even so, use a read-only login.

## 10b. Read only in the MongoDB Pipeline

The pipeline is a JS expression (the text as Compass shows it) evaluated on the incoming envelope, with the mongosh helpers (ObjectId, ISODate, NumberLong, NumberInt, NumberDecimal) defined inside the expression: they return Extended JSON, which the runner turns into BSON (`EJSON.deserialize`), so the core has no MongoDB code. A stage with `$out` or `$merge` is refused three times: in the text (validate), in the evaluated pipeline (the component) and in the driver (`runner/src/databases/mongodb.ts`). The documents come out with dates as Date and the rest as plain JSON (ObjectId as hex text, Decimal128 as text, Long as a number or text past 2^53, binary as base64).

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
| `GET /api/runs?project=` | The latest execution runs (without the per-component detail), optionally of one project; validation runs are not stored |
| `GET /api/runs/:id` | One run's full record |
| `GET /api/projects/:projectId/secrets` | Secret names: `[{name, source: 'project' \| 'shared'}]`; values never come back |
| `PUT /api/projects/:projectId/secrets/:name` | Saves a project secret: `{value}` |
| `DELETE /api/projects/:projectId/secrets/:name` | Deletes a project secret (shared ones stay in the file) |
| `GET /api/projects/:projectId/files` | Files: `[{name, size, updatedAt}]` |
| `POST /api/projects/:projectId/files` | Uploads a file (multipart, `file` field); the same name is replaced |
| `GET` / `DELETE /api/projects/:projectId/files/:name` | Downloads / deletes a file |

Environment variables: `DATABASE_URL` (Postgres; without it, PGlite in `runner/data.local/`), `RUNNER_PORT` (default 5190), `RUNNER_TIMEOUT_MS` (maximum time of a run, default 5 min) and `RUNNER_SCRIPT_TIMEOUT_MS` (maximum time of each TypeScript `process` call, default 30 s).

## 12. Targets in test runs

Targets are components that write outside the flow (today the **MongoDB Upsert**; later SQL insert, HTTP...). The rule exists so nobody writes half-baked data by running a flow "just to see if it works" and forgetting to disable the target. The user should not have to write a fake output either: what comes after a target usually needs its real answer (a generated id, a response body).

- **A target declares itself**: `sideEffects: true` on its `ComponentLogic` (later possibly a function of the config, e.g. an HTTP request is a target only for POST, PUT, PATCH and DELETE). Reading components (SQL Server Query, HTTP GET/HEAD) run normally in any mode.
- **Editor runs use `mode: 'validation'`** (the editor's Run). Triggers (endpoint, cron) will always run in `execution`.
- **Implemented**: the gate is in one place, `WorkflowExecution.runNode` (`core/src/engine/workflow-execution.ts`): in `validation`, a component with `sideEffects` runs with a context whose writes send nothing (`upsertDocuments` logs the first upserts it would send and answers null) and nothing goes out of it, so its branch stops there (the components after it get nothing) and it ends "with warnings". A pinned target replays its pin as usual. Errors it finds before writing (a filter value missing, a secret that does not exist) still show.
- **How the MongoDB Upsert writes** (in `execution`): in batches (default 500), one `updateOne(filter, {$set: document}, {upsert: true})` per envelope, so each one gets its own answer (`{matched, modified, upsertedId}`; `bulkWrite` only answers totals). The upserts of a batch go at the same time, except the ones with the same filter, which go one after the other in arrival order so the last one wins (`upsertInOrder`, `runner/src/databases/mongodb.ts`): sent together they have no order, and with a filter that is not a unique index both may insert. The log counts, per batch and in all, inserted, modified and unchanged (matched a document that already had those values).
- **What a target does in `validation`**, planned refinements, in this order:
  1. **SQL**: writes inside a transaction that is always rolled back. The output is real (rows affected, `OUTPUT inserted.id`) and nothing stays.
  2. **Pinned output** (like n8n's pin data): every real run stores the target's last output per input sample; a test run replays it. Today the user pins an output by hand (section 8).
  3. **Nothing to replay**: what is implemented now (the target logs what it would send and stops the branch). No output is made up.
- **Run for real** (implemented): a toolbar button next to Run that runs in `execution` after a confirmation listing the enabled targets that are going to write. Planned: in the test dialog, one target can be marked "run for real" on its own, with the same confirmation.
- **Optional, per target**: a test connection (a second secret used in `validation`, so it really writes, but to a staging database).
- The Disable button stays as it is: it bypasses a component in any mode.

## 13. Not done yet

- Secrets and files in the database / blob storage (today they live in runner folders).
- Triggers: an endpoint per flow and scheduling (cron).
- Authentication in the runner.
- Sources and targets beyond SQL Server and MongoDB (CSV, HTTP, other databases).

## 14. Suggested components

Ideas taken from n8n, not built yet (its Split Out, Remove Duplicates, Sort and Limit are our Split, Distinct, Sort and Limit; its Loop Over Items is our Aggregate).

| Component | What it does |
|---|---|
| **HTTP Request** | Calls an API per envelope (method, URL, headers, body as expressions, connection secret). Source with GET/HEAD; target with POST, PUT, PATCH and DELETE (follows section 12 in test runs). |
| **Compare Datasets** | Two inputs compared by key; outputs: only in A (new), only in B (removed), different, equal. For syncing two systems. |
| **Wait / Rate limit** | Waits a fixed time per envelope, or caps how many envelopes per second go through (APIs with quotas). |
| **Files (CSV, Excel, JSON)** | Reads a project file into one envelope per row (source) and writes the envelopes into a file (target). |
