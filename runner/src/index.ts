import {Hono} from 'hono'
import {logger} from 'hono/logger'
import {runWorkflow, type RunMode, type RunRecord, type ExecutableWorkflow} from '@dataflow/core'
import {evaluate} from './expressions'
import {prepareScript} from './scripts'
import {querySql} from './sqlserver'
import {projectRoutes, projectSecrets} from './projects'

/*
 * Workflow runner (see docs/architecture.md).
 * For now: runs on demand and keeps the latest runs in memory. A database, blob storage, authentication and
 * scheduling come in the next phases.
 */

// RUNNER_PORT, not PORT: whatever starts alongside it (concurrently, preview) usually passes PORT to the editor
const PORT = Number(process.env.RUNNER_PORT ?? 5190)
const MAX_STORED_RUNS = 50
/** maximum time of a run (default 5 min); past that, it is interrupted */
const TIMEOUT_MS = Number(process.env.RUNNER_TIMEOUT_MS ?? 5 * 60_000)

/** runs in progress right now, for the Stop button */
const inProgress = new Map<string, AbortController>()

/** stored record with the project and flow it came from (to list by project and go back to the flow) */
type StoredRun = RunRecord & {projectId?: string; workflowId?: string}

const runs: StoredRun[] = []

type RunRequest = {
  /** id chosen by the caller (so it can cancel while it runs); without it, the runner generates one */
  id?: string
  workflow: ExecutableWorkflow
  mode: RunMode
  parameters?: Record<string, string>
  /** workflow input (webhook body); only if the Start "accepts input" */
  input?: unknown
  /** the flow's project: picks the secrets and groups the runs */
  projectId?: string
  /** workflows the Workflow Invoker calls, by id (for now the editor sends them along; later they come from the database) */
  workflows?: Record<string, ExecutableWorkflow>
}

const app = new Hono().basePath('/api')

app.use(logger())

app.get('/health', c => c.json({ok: true}))

app.route('/', projectRoutes)

app.post('/runs', async c => {
  const request = await c.req.json<RunRequest>()
  if (!request?.workflow?.nodes) return c.json({error: 'Invalid workflow.'}, 400)
  const id = request.id && !inProgress.has(request.id) ? request.id : crypto.randomUUID()
  const control = new AbortController()
  inProgress.set(id, control)
  let record: RunRecord
  try {
    record = await runWorkflow(request.workflow, {
      mode: request.mode === 'execution' ? 'execution' : 'validation',
      id,
      parameterValues: request.parameters,
      input: request.input,
      workflows: request.workflows,
      evaluate,
      prepareScript,
      querySql,
      secrets: await projectSecrets(request.projectId),
      signal: control.signal,
      timeoutMs: TIMEOUT_MS,
    })
  } finally {
    inProgress.delete(id)
  }
  runs.unshift({...record, projectId: request.projectId, workflowId: request.workflow.id})
  runs.length = Math.min(runs.length, MAX_STORED_RUNS)
  return c.json(record)
})

app.post('/runs/:id/cancel', c => {
  const control = inProgress.get(c.req.param('id'))
  if (!control) return c.json({error: 'The run is not running.'}, 404)
  control.abort()
  return c.json({ok: true})
})

/** latest runs (of a project, with ?project=), without the components */
app.get('/runs', c => {
  const project = c.req.query('project')
  return c.json(runs.filter(r => !project || r.projectId === project).map(({components: _, ...summary}) => summary))
})

app.get('/runs/:id', c => {
  const record = runs.find(r => r.run.id === c.req.param('id'))
  return record ? c.json(record) : c.json({error: 'Run not found.'}, 404)
})

console.log(`Workflow runner at http://localhost:${PORT}/api`)

export default {port: PORT, fetch: app.fetch}
