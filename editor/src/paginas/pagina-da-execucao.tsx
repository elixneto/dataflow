import {useEffect, useState} from 'react'
import {Link, useNavigate, useParams} from 'react-router'
import type {RegistroDaExecucao} from '@dataflow/core'
import {ResultadoDaExecucao} from '@/execucao/painel-da-execucao'
import {obterProjeto} from '@/mock/projetos'
import {Cabecalho} from './cabecalho'

type ExecucaoGuardada = RegistroDaExecucao & {workflowId?: string}

/** Detalhe de uma execução (Logs, Métricas e Dados), aberto pela aba Execuções do projeto. */
export function PaginaDaExecucao() {
  const {projetoId = '', execucaoId = ''} = useParams()
  const navegar = useNavigate()
  const [registro, setRegistro] = useState<ExecucaoGuardada | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const projeto = obterProjeto(projetoId)

  useEffect(() => {
    fetch(`/api/execucoes/${encodeURIComponent(execucaoId)}`)
      .then(async r => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'Execução não encontrada (o runner guarda só as últimas, em memória).' : `O runner devolveu ${r.status}.`))))
      .then(setRegistro)
      .catch(e => setErro(e instanceof TypeError ? 'O runner não respondeu.' : e.message))
  }, [execucaoId])

  const voltar = `/projetos/${projetoId}?aba=execucoes`
  return (
    <div className="flex h-dvh flex-col bg-background">
      <Cabecalho trilha={[{rotulo: projeto?.nome ?? projetoId, para: `/projetos/${projetoId}`}, {rotulo: 'Execuções', para: voltar}, {rotulo: registro?.run.workflow ?? execucaoId.slice(0, 8)}]}>
        {registro?.workflowId && (
          <Link to={`/projetos/${projetoId}/fluxos/${registro.workflowId}`} className="text-sm text-primary hover:underline">Abrir o fluxo</Link>
        )}
      </Cabecalho>
      {erro && <p className="m-6 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>}
      {registro && (
        <section className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col border-x border-border bg-sidebar" aria-label="Resultado da execução">
          <ResultadoDaExecucao registro={registro} nomeDaPorta={(_, porta) => porta}
                               onIrPara={() => registro.workflowId && navegar(`/projetos/${projetoId}/fluxos/${registro.workflowId}`)}/>
        </section>
      )}
    </div>
  )
}
