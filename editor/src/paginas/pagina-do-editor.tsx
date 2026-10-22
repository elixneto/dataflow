import {useMemo} from 'react'
import {Link, Navigate, useParams, useSearchParams} from 'react-router'
import {EditorDeFluxo} from '@/editor/editor'
import {fluxoVazio, obterFluxo, salvarFluxo} from '@/mock/fluxos'

export function PaginaDoEditor() {
  const {projetoId = '', fluxoId} = useParams()
  // fluxo novo nasce na pasta que estava aberta
  const pasta = useSearchParams()[0].get('pasta') ?? ''
  const fluxo = useMemo(() => (fluxoId === 'novo' ? fluxoVazio(projetoId, pasta) : obterFluxo(fluxoId ?? '')), [fluxoId, projetoId, pasta])

  if (!fluxo) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        Fluxo não encontrado.
        <Link to={`/projetos/${projetoId}`} className="text-primary hover:underline">Voltar para o projeto</Link>
      </div>
    )
  }

  // key: trocar de fluxo recria o editor do zero (estado do React Flow e histórico)
  return <EditorDeFluxo key={fluxo.id} fluxo={fluxo} onSalvar={f => {
    const salvo = salvarFluxo(f)
    if (fluxoId === 'novo') window.history.replaceState(null, '', `/projetos/${salvo.projetoId}/fluxos/${salvo.id}`)
    return salvo
  }}/>
}

/** Link antigo (/editor/:id ou /fluxos/editor/:id): manda para o fluxo dentro do projeto dele. */
export function RedirecionarFluxoAntigo() {
  const {fluxoId = ''} = useParams()
  const fluxo = obterFluxo(fluxoId)
  return <Navigate to={fluxo ? `/projetos/${fluxo.projetoId}/fluxos/${fluxo.id}` : '/'} replace/>
}
