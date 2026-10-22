import {memo} from 'react'
import {NodeResizer, useReactFlow, type Node, type NodeProps} from '@xyflow/react'
import {cn} from '@/lib/utils'
import {useHistorico} from './historico'

/** Retângulo colorido atrás dos componentes, só para agrupar visualmente (não entra na execução). */
export type DadosDoGrupo = {
  titulo: string
  cor: string
}

export type NoGrupo = Node<DadosDoGrupo, 'grupo'>

export const TAMANHO_DO_GRUPO = {width: 600, height: 360}

export const CORES_DO_GRUPO = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#14b8a6', '#64748b']

/** Fica atrás das ligações e dos componentes. */
export const Z_DO_GRUPO = -1

function NoGrupoView({id, data, selected}: NodeProps<NoGrupo>) {
  const {updateNodeData} = useReactFlow<NoGrupo>()
  const {registrar, registrarEdicao} = useHistorico()

  function setCampo(chave: keyof DadosDoGrupo, valor: string) {
    registrarEdicao(`${id}:${chave}`)
    updateNodeData(id, {[chave]: valor})
  }

  return (
    <>
      <NodeResizer isVisible={selected} minWidth={160} minHeight={100} color={data.cor} onResizeStart={registrar}/>
      <div className="absolute inset-0 flex flex-col rounded-xl border-2"
           style={{
             backgroundColor: `color-mix(in oklch, ${data.cor} 16%, transparent)`,
             borderColor: `color-mix(in oklch, ${data.cor} ${selected ? 90 : 45}%, transparent)`,
           }}>
        <header className="flex shrink-0 items-center gap-2 px-3 py-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Título do grupo</span>
            <input value={data.titulo} onChange={e => setCampo('titulo', e.target.value)} placeholder="Grupo"
                   style={{color: `color-mix(in oklch, ${data.cor} 70%, var(--foreground))`}}
                   className="nodrag w-full truncate rounded bg-transparent px-1 text-sm font-semibold outline-none placeholder:opacity-60 focus-visible:bg-background"/>
          </label>
          {selected && (
            <div className="nodrag flex shrink-0 items-center gap-1" role="radiogroup" aria-label="Cor do grupo">
              {CORES_DO_GRUPO.map(cor => (
                <button key={cor} type="button" role="radio" aria-checked={cor === data.cor} aria-label={`Cor ${cor}`}
                        onClick={() => setCampo('cor', cor)} style={{backgroundColor: cor}}
                        className={cn('size-4 rounded-full border border-background', cor === data.cor && 'ring-2 ring-foreground/60 ring-offset-1 ring-offset-background')}/>
              ))}
              <label className="relative flex size-4 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-border"
                     title="Outra cor" style={{background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)'}}>
                <span className="sr-only">Outra cor</span>
                <input type="color" value={data.cor} onChange={e => setCampo('cor', e.target.value)} className="absolute inset-0 cursor-pointer opacity-0"/>
              </label>
            </div>
          )}
        </header>
      </div>
    </>
  )
}

export const NoGrupoMemo = memo(NoGrupoView)
