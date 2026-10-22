import {useRef, useState, type PointerEvent, type ReactNode} from 'react'
import {Trash2, X} from 'lucide-react'
import {Button} from '@/ui/button'

export type PosicaoDaJanela = {x: number; y: number}
export type TamanhoDaJanela = {w: number; h: number | null}

type Borda = 'direita' | 'baixo' | 'canto'

const LARGURA_INICIAL = 384
const LARGURA_MINIMA = 320
const ALTURA_MINIMA = 180

/**
 * Janela flutuante sobre a prancheta (configuração de um componente). Arrasta pelo título, redimensiona pela borda
 * direita, pela de baixo ou pelo canto, vem para a frente ao clicar e fecha no X ou no Esc. Várias podem ficar abertas.
 */
export function Janela({titulo, subtitulo, icone, posicao, tamanhoInicial, z, ativa, onMover, onRedimensionar, onFocar, onFechar, onExcluir, children, rotulo}: {
  titulo: string
  subtitulo?: string
  icone: ReactNode
  posicao: PosicaoDaJanela
  /** tamanho lembrado da última vez (sem ele, o padrão) */
  tamanhoInicial?: TamanhoDaJanela
  z: number
  ativa: boolean
  onMover: (posicao: PosicaoDaJanela) => void
  /** chamado ao soltar a borda, com o tamanho final */
  onRedimensionar?: (tamanho: TamanhoDaJanela) => void
  onFocar: () => void
  onFechar: () => void
  /** botão de lixeira ao lado do X (remove o componente da prancheta) */
  onExcluir?: () => void
  children: ReactNode
  rotulo: string
}) {
  const arraste = useRef<{dx: number; dy: number; pai: DOMRect} | null>(null)
  const janelaRef = useRef<HTMLElement>(null)
  // altura nula = a do conteúdo (até o limite da prancheta); vira fixa quando a pessoa redimensiona
  const [tamanho, setTamanho] = useState<TamanhoDaJanela>(tamanhoInicial ?? {w: LARGURA_INICIAL, h: null})
  const redimensao = useRef<{borda: Borda; x: number; y: number; w: number; h: number; pai: DOMRect} | null>(null)

  function iniciarRedimensao(borda: Borda, e: PointerEvent<HTMLElement>) {
    e.stopPropagation()
    const pai = (e.currentTarget.closest('[data-janelas]') as HTMLElement).getBoundingClientRect()
    redimensao.current = {borda, x: e.clientX, y: e.clientY, w: tamanho.w, h: janelaRef.current?.offsetHeight ?? 400, pai}
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function redimensionar(e: PointerEvent<HTMLElement>) {
    const r = redimensao.current
    if (!r) return
    const maxW = r.pai.width - posicao.x - 4
    const maxH = r.pai.height - posicao.y - 4
    setTamanho(atual => ({
      w: r.borda === 'baixo' ? atual.w : Math.min(Math.max(r.w + e.clientX - r.x, LARGURA_MINIMA), maxW),
      h: r.borda === 'direita' ? atual.h : Math.min(Math.max(r.h + e.clientY - r.y, ALTURA_MINIMA), maxH),
    }))
  }

  const alca = (borda: Borda, classe: string) => (
    <div aria-hidden="true" onPointerDown={e => iniciarRedimensao(borda, e)} onPointerMove={redimensionar}
         onPointerUp={() => {
           if (redimensao.current) onRedimensionar?.(tamanho)
           redimensao.current = null
         }} className={`absolute z-10 touch-none ${classe}`}/>
  )

  function iniciarArraste(e: PointerEvent<HTMLElement>) {
    if ((e.target as HTMLElement).closest('button')) return
    const pai = (e.currentTarget.closest('[data-janelas]') as HTMLElement).getBoundingClientRect()
    arraste.current = {dx: e.clientX - pai.left - posicao.x, dy: e.clientY - pai.top - posicao.y, pai}
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function arrastar(e: PointerEvent<HTMLElement>) {
    const a = arraste.current
    if (!a) return
    // não deixa o título sair da prancheta (senão não dá para pegar de volta)
    const x = Math.min(Math.max(e.clientX - a.pai.left - a.dx, -280), a.pai.width - 80)
    const y = Math.min(Math.max(e.clientY - a.pai.top - a.dy, 0), a.pai.height - 40)
    onMover({x, y})
  }

  return (
    <section ref={janelaRef} role="dialog" aria-label={rotulo} onPointerDownCapture={onFocar}
             onKeyDown={e => {
               if (e.key === 'Escape') onFechar()
             }}
             className={`pointer-events-auto absolute flex flex-col overflow-hidden rounded-xl border bg-sidebar shadow-2xl ${ativa ? 'border-primary/60' : 'border-sidebar-border'}`}
             style={{left: posicao.x, top: posicao.y, zIndex: z, width: tamanho.w, height: tamanho.h ?? undefined, maxHeight: `calc(100% - ${posicao.y + 8}px)`}}>
      <header onPointerDown={iniciarArraste} onPointerMove={arrastar} onPointerUp={() => (arraste.current = null)}
              className="flex cursor-grab touch-none select-none items-center gap-3 border-b border-sidebar-border px-4 py-3 active:cursor-grabbing">
        {icone}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{titulo}</span>
          {subtitulo && <span className="truncate text-xs text-muted-foreground">{subtitulo}</span>}
        </div>
        {onExcluir && (
          <Button variant="ghost" size="icon" onClick={onExcluir} aria-label="Remover componente" title="Remover componente"
                  className="text-muted-foreground hover:bg-destructive/15 hover:text-destructive">
            <Trash2 className="size-4" aria-hidden="true"/>
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={onFechar} aria-label="Fechar janela" title="Fechar (Esc)">
          <X className="size-4" aria-hidden="true"/>
        </Button>
      </header>
      {children}
      {alca('direita', 'inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-primary/30')}
      {alca('baixo', 'inset-x-0 bottom-0 h-1.5 cursor-ns-resize hover:bg-primary/30')}
      {alca('canto', 'bottom-0 right-0 size-4 cursor-nwse-resize rounded-br-xl bg-[linear-gradient(135deg,transparent_50%,var(--muted-foreground)_50%,var(--muted-foreground)_58%,transparent_58%,transparent_70%,var(--muted-foreground)_70%,var(--muted-foreground)_78%,transparent_78%)] opacity-60 hover:opacity-100')}
    </section>
  )
}
