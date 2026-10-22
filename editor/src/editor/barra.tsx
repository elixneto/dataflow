import {Link} from 'react-router'
import {CheckCircle2, CircleAlert, Eraser, Group, Loader2, MessageSquarePlus, Network, Play, Redo2, Save, Square, Undo2, Workflow} from 'lucide-react'
import type {ModoDeExecucao} from '@dataflow/core'
import {Button} from '@/ui/button'
import {BotaoTema} from '@/ui/tema'

export type ResultadoDaValidacao = {ok: boolean; mensagens: string[]} | null

type Props = {
  /** projeto do fluxo: o link da esquerda volta para ele */
  projeto: {id: string; nome: string}
  /** pasta do fluxo no projeto (vazio = raiz) */
  pasta?: string
  nome: string
  onNome: (nome: string) => void
  validacao: ResultadoDaValidacao
  onExecutar: () => void
  onParar: () => void
  validando: boolean
  rodando: ModoDeExecucao | null
  onLimpar: () => void
  onOrganizar: () => void
  onComentario: () => void
  onGrupo: () => void
  onDesfazer: () => void
  onRefazer: () => void
  podeDesfazer: boolean
  podeRefazer: boolean
  alterado: boolean
  onSalvar: () => void
  onVerPendencias: () => void
}

export function Barra(p: Props) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-background px-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/" className="flex items-center gap-2 hover:text-foreground" title="Projetos">
          <Workflow className="size-5 text-primary" aria-hidden="true"/>
        </Link>
        <span aria-hidden="true">/</span>
        <Link to={`/projetos/${p.projeto.id}`} className="hidden max-w-48 truncate hover:text-foreground sm:inline">{p.projeto.nome}</Link>
        <span aria-hidden="true">/</span>
        {p.pasta && (
          <>
            <Link to={`/projetos/${p.projeto.id}?pasta=${encodeURIComponent(p.pasta)}`} className="hidden max-w-40 truncate hover:text-foreground md:inline" title={p.pasta}>
              {p.pasta.split('/').pop()}
            </Link>
            <span aria-hidden="true" className="hidden md:inline">/</span>
          </>
        )}
      </div>
      <label className="flex min-w-0 flex-1 items-center">
        <span className="sr-only">Nome do fluxo</span>
        <input value={p.nome} onChange={e => p.onNome(e.target.value)}
               className="h-8 w-full max-w-xs rounded-md border border-transparent bg-transparent px-2 text-sm font-medium outline-none hover:border-border focus-visible:border-ring"/>
      </label>

      <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
        <Button variant="ghost" size="icon-sm" onClick={p.onDesfazer} disabled={!p.podeDesfazer} aria-label="Desfazer" title="Desfazer (Ctrl+Z)">
          <Undo2 className="size-4" aria-hidden="true"/>
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={p.onRefazer} disabled={!p.podeRefazer} aria-label="Refazer" title="Refazer (Ctrl+Shift+Z)">
          <Redo2 className="size-4" aria-hidden="true"/>
        </Button>
      </div>

      {p.validacao && (
        <button type="button" role="status" onClick={p.onVerPendencias}
                className={p.validacao.ok ? 'flex max-w-xs items-center gap-2 text-xs text-entity' : 'flex max-w-xs items-center gap-2 text-xs text-destructive hover:underline'}
                title={p.validacao.mensagens.join('\n')}>
          {p.validacao.ok ? <CheckCircle2 className="size-4 shrink-0" aria-hidden="true"/> : <CircleAlert className="size-4 shrink-0" aria-hidden="true"/>}
          <span className="truncate">
            {p.validacao.ok ? p.validacao.mensagens[0] : `${p.validacao.mensagens.length} pendência${p.validacao.mensagens.length === 1 ? '' : 's'}`}
          </span>
        </button>
      )}

      <div className="flex items-center gap-2">
        <BotaoTema/>
        <Button variant="outline" size="sm" onClick={p.onComentario}>
          <MessageSquarePlus className="size-4" aria-hidden="true"/> Comentário
        </Button>
        <Button variant="outline" size="sm" onClick={p.onGrupo} title="Retângulo colorido atrás dos componentes">
          <Group className="size-4" aria-hidden="true"/> Grupo
        </Button>
        <Button variant="ghost" size="sm" onClick={p.onOrganizar} title="Organizar da esquerda para a direita">
          <Network className="size-4 -rotate-90" aria-hidden="true"/> Organizar
        </Button>
        <Button variant="ghost" size="sm" onClick={p.onLimpar}>
          <Eraser className="size-4" aria-hidden="true"/> Limpar
        </Button>
        <Button variant="outline" size="sm" onClick={p.onSalvar} disabled={!p.alterado} title={p.alterado ? 'Salvar (Ctrl+S)' : 'Nada para salvar'}>
          <Save className="size-4" aria-hidden="true"/> {p.alterado ? 'Salvar' : 'Salvo'}
        </Button>
        {p.rodando ? (
          <Button size="sm" variant="destructive" onClick={p.onParar} title="Parar a execução">
            <Square className="size-3.5 fill-current" aria-hidden="true"/> Parar
          </Button>
        ) : (
          <Button size="sm" onClick={p.onExecutar} disabled={p.validando}>
            {p.validando ? <Loader2 className="size-4 animate-spin" aria-hidden="true"/> : <Play className="size-4" aria-hidden="true"/>}
            Executar
          </Button>
        )}
      </div>
    </header>
  )
}
