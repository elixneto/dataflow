import {memo} from 'react'
import {NodeResizer, useReactFlow, type Node, type NodeProps} from '@xyflow/react'
import {ChevronDown, ChevronRight, MessageSquareText} from 'lucide-react'
import {cn} from '@/lib/utils'
import {useHistorico} from './historico'

export type DadosDoComentario = {
  titulo: string
  texto: string
  recolhido: boolean
  alturaExpandido?: number
}

export type NoComentario = Node<DadosDoComentario, 'comentario'>

export const TAMANHO_DO_COMENTARIO = {width: 280, height: 160}

function NoComentarioView({id, data, selected, height}: NodeProps<NoComentario>) {
  const {updateNodeData, updateNode} = useReactFlow<NoComentario>()
  const {registrar, registrarEdicao} = useHistorico()

  function alternar() {
    registrar()
    if (data.recolhido) {
      updateNode(id, no => ({height: no.data.alturaExpandido ?? TAMANHO_DO_COMENTARIO.height, data: {...no.data, recolhido: false}}))
    } else {
      updateNode(id, no => ({height: undefined, data: {...no.data, recolhido: true, alturaExpandido: height ?? TAMANHO_DO_COMENTARIO.height}}))
    }
  }

  function setCampo(chave: 'titulo' | 'texto', valor: string) {
    registrarEdicao(`${id}:${chave}`)
    updateNodeData(id, {[chave]: valor})
  }

  const previa = data.texto.split('\n')[0]

  return (
    <>
      <NodeResizer isVisible={selected && !data.recolhido} minWidth={200} minHeight={100} color="var(--comentario)" onResizeStart={registrar}/>
      <div className={cn('flex flex-col overflow-hidden rounded-xl border border-dashed bg-comentario/30 text-foreground transition-colors',
        data.recolhido ? 'h-auto w-full' : 'absolute inset-0 contain-strict',
        selected ? 'border-comentario' : 'border-comentario/50')}>
        <header className="flex shrink-0 items-center gap-1.5 px-2 py-2">
          <button type="button" onClick={alternar} aria-expanded={!data.recolhido}
                  aria-label={data.recolhido ? 'Expandir comentário' : 'Recolher comentário'}
                  className="nodrag flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">
            {data.recolhido ? <ChevronRight className="size-3.5" aria-hidden="true"/> : <ChevronDown className="size-3.5" aria-hidden="true"/>}
          </button>
          <MessageSquareText className="size-3.5 shrink-0 text-comentario" aria-hidden="true"/>
          <label className="min-w-0 flex-1">
            <span className="sr-only">Título do comentário</span>
            <input value={data.titulo} onChange={e => setCampo('titulo', e.target.value)} placeholder="Comentário"
                   className="nodrag w-full truncate rounded bg-transparent px-1 text-sm font-semibold outline-none placeholder:text-muted-foreground focus-visible:bg-background"/>
          </label>
        </header>
        {data.recolhido ? (
          previa && <p className="truncate border-t border-dashed border-comentario/40 px-3 py-1.5 text-xs text-muted-foreground">{previa}</p>
        ) : (
          <label className="flex min-h-0 flex-1 border-t border-dashed border-comentario/40">
            <span className="sr-only">Texto do comentário</span>
            <textarea value={data.texto} onChange={e => setCampo('texto', e.target.value)}
                      placeholder="Escreva uma anotação sobre esta parte do fluxo..."
                      className="nodrag nowheel h-full w-full resize-none bg-transparent px-3 py-2 text-xs leading-relaxed outline-none placeholder:text-muted-foreground"/>
          </label>
        )}
      </div>
    </>
  )
}

export const NoComentarioMemo = memo(NoComentarioView)
