import {useMemo, useState, type DragEvent} from 'react'
import {GripVertical, PanelLeftClose, PanelLeftOpen, Search} from 'lucide-react'
import {CATEGORIAS, DRAG_MIME, PALETA} from '@/componentes/catalogo'
import type {Categoria} from '@/componentes/tipos'
import {cn} from '@/lib/utils'

const ORDEM: Categoria[] = ['fonte', 'codigo', 'transformacao', 'fluxo', 'entidade']
const CHAVE_RECOLHIDA = 'dataflow-fluxos-paleta-recolhida'

function lerRecolhida() {
  try {
    return localStorage.getItem(CHAVE_RECOLHIDA) === '1'
  } catch {
    return false
  }
}

export function Paleta({onAdicionar}: {onAdicionar: (tipo: string) => void}) {
  const [busca, setBusca] = useState('')
  const [recolhida, setRecolhida] = useState(lerRecolhida)

  function alternar() {
    setRecolhida(r => {
      try {
        localStorage.setItem(CHAVE_RECOLHIDA, r ? '0' : '1')
      } catch {
        // sem storage: vale só até recarregar
      }
      return !r
    })
  }

  const grupos = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    const filtrados = PALETA.filter(c => !termo || c.rotulo.toLowerCase().includes(termo) || c.descricao.toLowerCase().includes(termo))
    return ORDEM.map(categoria => ({categoria, itens: filtrados.filter(c => c.categoria === categoria)})).filter(g => g.itens.length > 0)
  }, [busca])

  function aoArrastar(event: DragEvent<HTMLLIElement>, tipo: string) {
    event.dataTransfer.setData(DRAG_MIME, tipo)
    event.dataTransfer.effectAllowed = 'move'
  }

  // recolhida: só os ícones, que continuam arrastáveis
  if (recolhida) {
    return (
      <aside className="flex w-14 shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <button type="button" onClick={alternar} title="Mostrar componentes" aria-label="Mostrar componentes"
                className="my-3 flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
          <PanelLeftOpen className="size-4" aria-hidden="true"/>
        </button>
        <div className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-y-auto border-t border-sidebar-border py-3">
          {ORDEM.map(categoria => {
            const cat = CATEGORIAS[categoria]
            return (
              <ul key={categoria} className="flex flex-col gap-1.5" aria-label={cat.rotulo}>
                {PALETA.filter(c => c.categoria === categoria).map(c => {
                  const Icone = c.icone
                  return (
                    <li key={c.tipo} draggable onDragStart={e => aoArrastar(e, c.tipo)} onDoubleClick={() => onAdicionar(c.tipo)} title={`${c.rotulo}: ${c.descricao}`}
                        className={cn('flex size-8 cursor-grab items-center justify-center rounded-md active:cursor-grabbing hover:ring-1 hover:ring-sidebar-border', cat.corFundo, cat.corTexto)}>
                      <Icone className="size-4" aria-hidden="true"/>
                      <span className="sr-only">{c.rotulo}</span>
                    </li>
                  )
                })}
              </ul>
            )
          })}
        </div>
      </aside>
    )
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex flex-col gap-3 border-b border-sidebar-border p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Componentes</h2>
          <button type="button" onClick={alternar} title="Recolher componentes" aria-label="Recolher componentes"
                  className="-my-1 flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
            <PanelLeftClose className="size-4" aria-hidden="true"/>
          </button>
        </div>
        <label className="relative flex items-center">
          <span className="sr-only">Buscar componentes</span>
          <Search className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" aria-hidden="true"/>
          <input type="search" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar..."
                 className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"/>
        </label>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4 [&>*]:shrink-0">
        {grupos.map(({categoria, itens}) => {
          const cat = CATEGORIAS[categoria]
          return (
            <section key={categoria} className="flex flex-col gap-2" aria-labelledby={`paleta-${categoria}`}>
              <h3 id={`paleta-${categoria}`} className={cn('flex items-center gap-2 font-mono text-xs uppercase tracking-wider', cat.corTexto)}>
                <span className={cn('size-2 rounded-sm border', cat.corFundo, cat.corBorda)} aria-hidden="true"/>
                {cat.rotulo}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {itens.map(c => {
                  const Icone = c.icone
                  return (
                    <li key={c.tipo} draggable onDragStart={e => aoArrastar(e, c.tipo)} onDoubleClick={() => onAdicionar(c.tipo)}
                        className="group flex cursor-grab items-center gap-3 rounded-md border border-transparent bg-sidebar-accent/50 p-2 transition-colors hover:border-sidebar-border hover:bg-sidebar-accent active:cursor-grabbing">
                      <div className={cn('flex size-8 shrink-0 items-center justify-center rounded-md', cat.corFundo, cat.corTexto)}>
                        <Icone className="size-4" aria-hidden="true"/>
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">{c.rotulo}</span>
                        <span className="truncate text-xs text-muted-foreground">{c.descricao}</span>
                      </div>
                      <GripVertical className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true"/>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
        {grupos.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {PALETA.length === 0 ? 'Nenhum componente ainda: eles vão ser desenhados um a um.' : 'Nenhum componente encontrado.'}
          </p>
        )}
      </div>

      {/*<p className="border-t border-sidebar-border p-4 text-xs leading-relaxed text-muted-foreground">*/}
      {/*  Arraste um componente para a prancheta e ligue a saída de um à entrada de outro.*/}
      {/*</p>*/}
    </aside>
  )
}
