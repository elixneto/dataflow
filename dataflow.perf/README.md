# dataflow.perf

Performance scenarios for the dataflow engine. Each scenario is one or more flows (YAML, the editor's Download
format) run by the server's own `runJob` in a fresh Bun process, against SQL Server and MongoDB in containers of their
own and a local fake HTTP API. The report is plain text on the terminal and a static web page (`report/`) that reads
the results; every result is kept in `results/<hostname>.jsonl`, outside git (the page's data, not meant to be read
by hand). The design is [docs/designs/dataflow-perf.md](../docs/designs/dataflow-perf.md).

This package is not part of the app: nothing of it goes into the server's image, and it never touches the development
stack (the server, its Postgres, ports 5180, 5190 and 5432).

## Running

From the repository root:

```sh
bun run perf                                   # every scenario
bun run perf in-memory-pipeline http-slow-api  # some of them
bun run perf sqlserver-to-mongodb --quick      # 2 runs, no warm-up, a smaller size
bun run perf --list                            # the scenarios, their services and metrics
bun run perf --serve --open                    # run nothing: open the report page with the results kept so far
```

Flags go after the script name, without `--`: `--runs N` (default 5), `--quick`, `--size N`, `--list`, `--serve`
(serve the report page on http://127.0.0.1:5196 until Ctrl+C; with one scenario, open on it), `--open` (open the page
in the browser; after a run, serve it and open it).

## Reading the results

- **Terminal**: one table per scenario while it runs, and a summary at the end.
- **Report page** (`bun run perf --serve --open`):
  - the overview: the latest execution of every scenario, its engine time and the change against the previous one;
  - a scenario: its history per metric (one chart each) and every execution, newest first;
  - the comparison: tick executions in the table, or click points on a chart, and they show side by side, the oldest as
    the baseline: every metric and every component's active and waiting time with its change against the baseline
    (green went the better way, red worse, grey under 2 %), and each execution's runs.

  The URL keeps what you are looking at (scenario, size, executions), so back, reload and a shared link work. Opened as
  a file (`results/report/index.html`) the page cannot read the results by itself: it asks you to pick or drop the
  `.jsonl`.

Each scenario runs one warm-up (discarded) and N measured runs, each in a new process. The report shows, for the
metrics the scenario picks, the median, the minimum, the maximum and the median of the previous result of the same
scenario and size on this machine. There are no limits and no verdict: you compare. When the engine's time varies more
than 10 % between runs the report says "high noise": run more, or on a quieter machine, before reading small changes.

Exit code: 0; 1 when a measured run failed; 2 when the environment did (Docker, a port in use, the data load).
Ctrl+C saves what was measured as a partial result.

## What it needs

- `bun install` at the root.
- For `sqlserver-to-mongodb` and `mongodb-pipeline-aggregate`: Docker Desktop with about 4 GB for containers, and ports
  14330 (SQL Server) and 27030 (MongoDB) free. The first run downloads the images (a few GB) and loads the data
  once; the containers keep running between runs.
- For `http-slow-api`: port 5195 free (the fake API runs as a local process while the scenario runs).
- `in-memory-pipeline` and `flow-invoker-fanout` need nothing else.

SQL Server has no ARM64 image: on Apple Silicon it runs emulated, and its numbers do not compare with other machines.

## Cleaning up

```sh
docker compose -p dataflow-perf down       # stop the containers (the data stays in the volumes)
docker compose -p dataflow-perf down -v    # also drop the data (the next run loads it again)
```

`results/` is local: delete it whenever you like.

## Adding a scenario

1. A folder `scenarios/<id>/` with `scenario.ts` (a default export of `Scenario`, see `src/scenario.ts`), `data.ts`
   (a deterministic generator, `mulberry32` from `fake-api/random.ts`, never `Math.random`, and a `DATA_VERSION` to
   bump when the data changes) and `flows/*.yaml`.
2. Build the flow in the editor, use the connections `perf-sqlserver` or `perf-mongodb` (fixed ids, see `src/flows.ts`;
   create profiles with those ids, or edit the YAML), Download it into `flows/`, and give it `id: <scenario id>`.
   A flow it calls (Flow Invoker) goes in the same folder with an id of its own.
3. Label the components: rulers and `throughputNode` name them by label (`component.<label>.waitingMs`).
4. Register it in `src/scenarios.ts`. `bun run test` checks its flows against the core.

## The fake API

`bun run --cwd=dataflow.perf fake-api` runs it on its own (PORT, default 5195). `GET /items/:id` answers after
`delayMs ± jitterMs` and fails with 503 at `failRate`, both drawn from `seed` and the item's id, so the same item gets
the same answer on every run; `GET /_stats` and `POST /_reset` count what it served.
