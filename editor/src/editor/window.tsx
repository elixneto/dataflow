import {useRef, useState, type PointerEvent, type ReactNode} from 'react'
import {Trash2, X} from 'lucide-react'
import {Button} from '@/ui/button'

export type WindowPosition = {x: number; y: number}
export type WindowSize = {w: number; h: number | null}

type Edge = 'right' | 'bottom' | 'corner'

const INITIAL_WIDTH = 384
const MIN_WIDTH = 320
const MIN_HEIGHT = 180

/**
 * Floating window over the canvas (a component's configuration). Drags by the title, resizes by the right edge,
 * the bottom edge or the corner, comes to the front on click and closes on X or Esc. Several can stay open.
 */
export function FloatingWindow({title, subtitle, icon, position, initialSize, z, active, onMove, onResize, onFocus, onClose, onDelete, children, label}: {
  title: string
  subtitle?: string
  icon: ReactNode
  position: WindowPosition
  /** size remembered from last time (without it, the default) */
  initialSize?: WindowSize
  z: number
  active: boolean
  onMove: (position: WindowPosition) => void
  /** called when the edge is released, with the final size */
  onResize?: (size: WindowSize) => void
  onFocus: () => void
  onClose: () => void
  /** trash button next to the X (removes the component from the canvas) */
  onDelete?: () => void
  children: ReactNode
  label: string
}) {
  const drag = useRef<{dx: number; dy: number; parent: DOMRect} | null>(null)
  const windowRef = useRef<HTMLElement>(null)
  // null height = the content's (up to the canvas limit); becomes fixed when the person resizes
  const [size, setSize] = useState<WindowSize>(initialSize ?? {w: INITIAL_WIDTH, h: null})
  const resizing = useRef<{edge: Edge; x: number; y: number; w: number; h: number; parent: DOMRect} | null>(null)

  function startResize(edge: Edge, e: PointerEvent<HTMLElement>) {
    e.stopPropagation()
    const parent = (e.currentTarget.closest('[data-windows]') as HTMLElement).getBoundingClientRect()
    resizing.current = {edge, x: e.clientX, y: e.clientY, w: size.w, h: windowRef.current?.offsetHeight ?? 400, parent}
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function resize(e: PointerEvent<HTMLElement>) {
    const r = resizing.current
    if (!r) return
    const maxW = r.parent.width - position.x - 4
    const maxH = r.parent.height - position.y - 4
    setSize(current => ({
      w: r.edge === 'bottom' ? current.w : Math.min(Math.max(r.w + e.clientX - r.x, MIN_WIDTH), maxW),
      h: r.edge === 'right' ? current.h : Math.min(Math.max(r.h + e.clientY - r.y, MIN_HEIGHT), maxH),
    }))
  }

  const handle = (edge: Edge, className: string) => (
    <div aria-hidden="true" onPointerDown={e => startResize(edge, e)} onPointerMove={resize}
         onPointerUp={() => {
           if (resizing.current) onResize?.(size)
           resizing.current = null
         }} className={`absolute z-10 touch-none ${className}`}/>
  )

  function startDrag(e: PointerEvent<HTMLElement>) {
    if ((e.target as HTMLElement).closest('button')) return
    const parent = (e.currentTarget.closest('[data-windows]') as HTMLElement).getBoundingClientRect()
    drag.current = {dx: e.clientX - parent.left - position.x, dy: e.clientY - parent.top - position.y, parent}
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function dragMove(e: PointerEvent<HTMLElement>) {
    const a = drag.current
    if (!a) return
    // keeps the title inside the canvas (otherwise it cannot be grabbed again)
    const x = Math.min(Math.max(e.clientX - a.parent.left - a.dx, -280), a.parent.width - 80)
    const y = Math.min(Math.max(e.clientY - a.parent.top - a.dy, 0), a.parent.height - 40)
    onMove({x, y})
  }

  return (
    <section ref={windowRef} role="dialog" aria-label={label} onPointerDownCapture={onFocus}
             onKeyDown={e => {
               if (e.key === 'Escape') onClose()
             }}
             className={`pointer-events-auto absolute flex flex-col overflow-hidden rounded-xl border bg-sidebar shadow-2xl ${active ? 'border-primary/60' : 'border-sidebar-border'}`}
             style={{left: position.x, top: position.y, zIndex: z, width: size.w, height: size.h ?? undefined, maxHeight: `calc(100% - ${position.y + 8}px)`}}>
      <header onPointerDown={startDrag} onPointerMove={dragMove} onPointerUp={() => (drag.current = null)}
              className="flex cursor-grab touch-none select-none items-center gap-3 border-b border-sidebar-border px-4 py-3 active:cursor-grabbing">
        {icon}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{title}</span>
          {subtitle && <span className="truncate text-xs text-muted-foreground">{subtitle}</span>}
        </div>
        {onDelete && (
          <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Remove component" title="Remove component"
                  className="text-muted-foreground hover:bg-destructive/15 hover:text-destructive">
            <Trash2 className="size-4" aria-hidden="true"/>
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close window" title="Close (Esc)">
          <X className="size-4" aria-hidden="true"/>
        </Button>
      </header>
      {children}
      {handle('right', 'inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-primary/30')}
      {handle('bottom', 'inset-x-0 bottom-0 h-1.5 cursor-ns-resize hover:bg-primary/30')}
      {handle('corner', 'bottom-0 right-0 size-4 cursor-nwse-resize rounded-br-xl bg-[linear-gradient(135deg,transparent_50%,var(--muted-foreground)_50%,var(--muted-foreground)_58%,transparent_58%,transparent_70%,var(--muted-foreground)_70%,var(--muted-foreground)_78%,transparent_78%)] opacity-60 hover:opacity-100')}
    </section>
  )
}
