import type {Edge} from '@xyflow/react'
import type {ModoDeExecucao, ParametroDoWorkflow, RegistroDaExecucao, WorkflowParaExecutar} from '@dataflow/core'
import {ehComponente} from '@/editor/validacao'
import {obterFluxo, type NoDoFluxo} from '@/mock/fluxos'
import {obterProjeto} from '@/mock/projetos'

/** O que o editor tem → o que o runner recebe (sem posição, comentários nem nada visual). */
export function paraExecutar(nome: string, parametros: ParametroDoWorkflow[], nodes: NoDoFluxo[], edges: Edge[], id?: string, projetoId?: string): WorkflowParaExecutar {
  return {
    id,
    projeto: (projetoId && obterProjeto(projetoId)?.nome) || 'Rascunho',
    workflow: nome,
    parametros,
    nos: nodes.filter(ehComponente).map(n => ({
      id: n.id, tipo: n.data.tipo, rotulo: n.data.rotulo, config: n.data.config,
      chaveDeSaida: n.data.chaveDeSaida, override: n.data.override, desativado: n.data.desativado,
    })),
    ligacoes: edges.map(e => ({
      origem: e.source, portaDeOrigem: e.sourceHandle ?? 'out-0', destino: e.target, portaDeDestino: e.targetHandle ?? 'in-0',
    })),
  }
}

/**
 * Workflows que este chama pelo Workflow Invoker, e os que esses chamam (do jeito que estão salvos). Vão junto para o
 * runner enquanto os fluxos ficam no navegador; o que chama a si mesmo o runner barra.
 */
export function workflowsChamados(raiz: WorkflowParaExecutar): Record<string, WorkflowParaExecutar> {
  const achados: Record<string, WorkflowParaExecutar> = {}
  const pendentes = [raiz]
  while (pendentes.length) {
    const atual = pendentes.pop()!
    for (const no of atual.nos.filter(n => n.tipo === 'workflow')) {
      const id = String(no.config.workflowId ?? '')
      if (!id || achados[id]) continue
      const fluxo = id === raiz.id ? undefined : obterFluxo(id)
      const wf = fluxo ? paraExecutar(fluxo.nome, fluxo.parametros ?? [], fluxo.nodes, fluxo.edges, fluxo.id, fluxo.projetoId) : id === raiz.id ? raiz : undefined
      if (!wf) continue
      achados[id] = wf
      pendentes.push(wf)
    }
  }
  return achados
}

/** Chama o runner (runner). Em dev o Vite repassa /api para http://localhost:5190. */
/** Entrada de teste do Início (JSON), quando ele recebe entrada; undefined se não recebe ou está vazia. */
export function entradaDeTesteDo(workflow: WorkflowParaExecutar): unknown {
  const inicio = workflow.nos.find(n => n.tipo === 'inicio')
  if (inicio?.config.recebeEntrada !== true) return undefined
  const texto = String(inicio.config.entradaDeTeste ?? '').trim()
  if (!texto) return undefined
  try {
    return JSON.parse(texto)
  } catch {
    throw new Error('A entrada de teste do Start não é um JSON válido.')
  }
}

export async function executarNoRunner(workflow: WorkflowParaExecutar, modo: ModoDeExecucao, id: string, parametros?: Record<string, string>, projetoId?: string): Promise<RegistroDaExecucao> {
  const entrada = entradaDeTesteDo(workflow)
  let resposta: Response
  try {
    resposta = await fetch(`${import.meta.env.BASE_URL}api/execucoes`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({id, workflow, modo, parametros, entrada, projetoId, workflows: workflowsChamados(workflow)}),
    })
  } catch {
    throw new Error('O runner não respondeu. Ele está rodando? (npm run start na raiz do repositório)')
  }
  if (!resposta.ok) {
    const texto = await resposta.text()
    throw new Error(resposta.status === 502 || resposta.status === 504 || texto.includes('ECONNREFUSED')
      ? 'O runner não respondeu. Ele está rodando? (npm run start na raiz do repositório)'
      : `O runner devolveu ${resposta.status}: ${texto.slice(0, 200)}`)
  }
  return resposta.json() as Promise<RegistroDaExecucao>
}

/** Botão Parar: pede ao runner para interromper a execução (a resposta do Executar chega como "Execução cancelada."). */
export async function cancelarNoRunner(id: string) {
  await fetch(`${import.meta.env.BASE_URL}api/execucoes/${encodeURIComponent(id)}/cancelar`, {method: 'POST'}).catch(() => undefined)
}
