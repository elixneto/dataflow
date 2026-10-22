# dataflow/editor — the flows app (React)

Projects, the visual flow editor, runs, secrets and files.

## Stack and commands

- Vite + React 19 + TypeScript + Tailwind 4 + React Flow (`@xyflow/react`) + Monaco + lucide-react.
- `npm run start` → http://localhost:5180/ · `npm run build` → `dist/` · `npm run typecheck`.
- `base: '/'`: the app lives at the root. In production, `dist/` can be served by any static server, with `/api` proxied to the runner.
- `.npmrc` points to the public npm registry.
- Run calls the runner (`../runner`, Bun, port 5190): in dev Vite proxies `/api` to it (`RUNNER_URL` changes the target). To start both together: `npm run start` at the repository root.
- The components' logic (validate/execute) lives in `../core` (alias `@dataflow/core`); here only the visual part.

## Structure

| Folder | What it is |
|---|---|
| `src/components/` | `types.ts` (the visual contract `ComponentDef`: ports, `Card`, `Panel`, `Docs`, `validate`), `catalog.ts` (palette, colors, `BY_TYPE`, Start/End) and the visual part of each component. |
| `src/run/` | Editor → runner conversion, the calls to the runner and the panel with the run result (per component: time, counts, logs, samples). |
| `src/editor/` | Canvas (React Flow), generic node, comment, group, palette, toolbar, history (Ctrl+Z), assembly validation and the configuration **windows**: a click only selects; a double click opens the component's window (one per component, several open, draggable, Esc closes). The Start opens the workflow parameters. |
| `src/mock/` | Projects (`projects.ts`, key `dataflow-projects-v1`) and flows (`flows.ts`, key `dataflow-flows-v1`; each flow has `projectId` and `folder`, a path inside the project; the project stores the empty folders) in localStorage, with the examples. They become API calls when the backend exists. Runs, secrets and files already come from the runner. |
| `src/pages/` | Routes: `/` projects, `/projects/:id` (Flows, Runs, Secrets, Files tabs; `?tab=`), `/projects/:id/flows/:flowId` editor, `/projects/:id/runs/:runId` detail. The old `/editor/:id` redirects. |
| `src/ui/` | Shared pieces: button, expression field, code editor (Monaco), resizable columns, theme. |

## Conventions

The same as the [root CLAUDE.md](../CLAUDE.md).
