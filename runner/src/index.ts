import {Hono} from 'hono'
import {logger} from 'hono/logger'
import {executarWorkflow, type ModoDeExecucao, type RegistroDaExecucao, type WorkflowParaExecutar} from '@dataflow/core'
import {avaliar} from './expressions'
import {prepararScript} from './scripts'
import {consultarSql} from './sqlserver'
import {rotasDeProjetos, segredosDoProjeto} from './projetos'

/*
 * Runner dos workflows (plano em _docs/planejamento/workflow-execucao.md, seção 9).
 * Por enquanto: executa sob demanda e guarda as últimas execuções em memória. MongoDB, Blob, autenticação e
 * agendamento entram nas próximas fases.
 */

// RUNNER_PORT, não PORT: quem sobe junto (concurrently, preview) costuma passar PORT para o editor
const PORTA = Number(process.env.RUNNER_PORT ?? 5190)
const MAX_EXECUCOES_GUARDADAS = 50
/** tempo máximo de uma execução (padrão 5 min); passou disso, ela é interrompida */
const TEMPO_MAXIMO_MS = Number(process.env.RUNNER_TEMPO_MAXIMO_MS ?? 5 * 60_000)

/** execuções rodando agora, para o botão Parar */
const emAndamento = new Map<string, AbortController>()

/** registro guardado com o projeto e o fluxo de onde veio (para listar por projeto e voltar ao fluxo) */
type ExecucaoGuardada = RegistroDaExecucao & {projetoId?: string; workflowId?: string}

const execucoes: ExecucaoGuardada[] = []

type PedidoDeExecucao = {
  /** id escolhido por quem chama (para poder cancelar enquanto roda); sem ele, o runner gera */
  id?: string
  workflow: WorkflowParaExecutar
  modo: ModoDeExecucao
  parametros?: Record<string, string>
  /** entrada do workflow (corpo do webhook); só se o Início "recebe entrada" */
  entrada?: unknown
  /** projeto do fluxo: escolhe os segredos e agrupa as execuções */
  projetoId?: string
  /** workflows que o Workflow Invoker chama, pelo id (por enquanto o editor manda junto; depois vêm do banco) */
  workflows?: Record<string, WorkflowParaExecutar>
}

const app = new Hono().basePath('/api')

app.use(logger())

app.get('/saude', c => c.json({ok: true}))

app.route('/', rotasDeProjetos)

app.post('/execucoes', async c => {
  const pedido = await c.req.json<PedidoDeExecucao>()
  if (!pedido?.workflow?.nos) return c.json({erro: 'Workflow inválido.'}, 400)
  const id = pedido.id && !emAndamento.has(pedido.id) ? pedido.id : crypto.randomUUID()
  const controle = new AbortController()
  emAndamento.set(id, controle)
  let registro: RegistroDaExecucao
  try {
    registro = await executarWorkflow(pedido.workflow, {
      modo: pedido.modo === 'execution' ? 'execution' : 'validation',
      id,
      valoresDosParametros: pedido.parametros,
      entrada: pedido.entrada,
      workflows: pedido.workflows,
      avaliar,
      prepararScript,
      consultarSql,
      segredos: await segredosDoProjeto(pedido.projetoId),
      sinal: controle.signal,
      tempoMaximoMs: TEMPO_MAXIMO_MS,
    })
  } finally {
    emAndamento.delete(id)
  }
  execucoes.unshift({...registro, projetoId: pedido.projetoId, workflowId: pedido.workflow.id})
  execucoes.length = Math.min(execucoes.length, MAX_EXECUCOES_GUARDADAS)
  return c.json(registro)
})

app.post('/execucoes/:id/cancelar', c => {
  const controle = emAndamento.get(c.req.param('id'))
  if (!controle) return c.json({erro: 'Execução não está rodando.'}, 404)
  controle.abort()
  return c.json({ok: true})
})

/** últimas execuções (de um projeto, com ?projeto=), sem os componentes */
app.get('/execucoes', c => {
  const projeto = c.req.query('projeto')
  return c.json(execucoes.filter(e => !projeto || e.projetoId === projeto).map(({componentes: _, ...resumo}) => resumo))
})

app.get('/execucoes/:id', c => {
  const registro = execucoes.find(e => e.run.id === c.req.param('id'))
  return registro ? c.json(registro) : c.json({erro: 'Execução não encontrada.'}, 404)
})

console.log(`Runner dos workflows em http://localhost:${PORTA}/api`)

export default {port: PORTA, fetch: app.fetch}
