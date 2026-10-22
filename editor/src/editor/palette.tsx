import {useMemo, useState, type DragEvent} from 'react'
import {GripVertical, PanelLeftClose, PanelLeftOpen, Search} from 'lucide-react'
import {CATEGORIES, DRAG_MIME, PALETTE} from '@/components/catalog'
import type {Category} from '@/components/types'
import {cn} from '@/lib/utils'

const ORDER: Category[] = ['source', 'code', 'transformation', 'flow', 'entity']
const COLLAPSED_KEY = 'dataflow-flows-palette-collapsed'

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

export function Palette({onAdd}: {onAdd: (type: string) => void}) {
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState(readCollapsed)

  function toggle() {
    setCollapsed(c => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1')
      } catch {
        // no storage: only lasts until reload
      }
      return !c
    })
  }

  const groups = useMemo(() => {
    const term = search.trim().toLowerCase()
    const filtered = PALETTE.filter(c => !term || c.label.toLowerCase().includes(term) || c.description.toLowerCase().includes(term))
    return ORDER.map(category => ({category, items: filtered.filter(c => c.category === category)})).filter(g => g.items.length > 0)
  }, [search])

  function onDragStart(event: DragEvent<HTMLLIElement>, type: string) {
    event.dataTransfer.setData(DRAG_MIME, type)
    event.dataTransfer.effectAllowed = 'move'
  }

  // collapsed: only the icons, which stay draggable
  if (collapsed) {
    return (
      <aside className="flex w-14 shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <button type="button" onClick={toggle} title="Show components" aria-label="Show components"
                className="my-3 flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
          <PanelLeftOpen className="size-4" aria-hidden="true"/>
        </button>
        <div className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-y-auto border-t border-sidebar-border py-3">
          {ORDER.map(category => {
            const cat = CATEGORIES[category]
            return (
              <ul key={category} className="flex flex-col gap-1.5" aria-label={cat.label}>
                {PALETTE.filter(c => c.category === category).map(c => {
                  const Icon = c.icon
                  return (
                    <li key={c.type} draggable onDragStart={e => onDragStart(e, c.type)} onDoubleClick={() => onAdd(c.type)} title={`${c.label}: ${c.description}`}
                        className={cn('flex size-8 cursor-grab items-center justify-center rounded-md active:cursor-grabbing hover:ring-1 hover:ring-sidebar-border', cat.bgColor, cat.textColor)}>
                      <Icon className="size-4" aria-hidden="true"/>
                      <span className="sr-only">{c.label}</span>
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
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Components</h2>
          <button type="button" onClick={toggle} title="Collapse components" aria-label="Collapse components"
                  className="-my-1 flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
            <PanelLeftClose className="size-4" aria-hidden="true"/>
          </button>
        </div>
        <label className="relative flex items-center">
          <span className="sr-only">Search components</span>
          <Search className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" aria-hidden="true"/>
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
                 className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"/>
        </label>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4 [&>*]:shrink-0">
        {groups.map(({category, items}) => {
          const cat = CATEGORIES[category]
          return (
            <section key={category} className="flex flex-col gap-2" aria-labelledby={`palette-${category}`}>
              <h3 id={`palette-${category}`} className={cn('flex items-center gap-2 font-mono text-xs uppercase tracking-wider', cat.textColor)}>
                <span className={cn('size-2 rounded-sm border', cat.bgColor, cat.borderColor)} aria-hidden="true"/>
                {cat.label}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {items.map(c => {
                  const Icon = c.icon
                  return (
                    <li key={c.type} draggable onDragStart={e => onDragStart(e, c.type)} onDoubleClick={() => onAdd(c.type)}
                        className="group flex cursor-grab items-center gap-3 rounded-md border border-transparent bg-sidebar-accent/50 p-2 transition-colors hover:border-sidebar-border hover:bg-sidebar-accent active:cursor-grabbing">
                      <div className={cn('flex size-8 shrink-0 items-center justify-center rounded-md', cat.bgColor, cat.textColor)}>
                        <Icon className="size-4" aria-hidden="true"/>
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">{c.label}</span>
                        <span className="truncate text-xs text-muted-foreground">{c.description}</span>
                      </div>
                      <GripVertical className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true"/>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
        {groups.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {PALETTE.length === 0 ? 'No components yet: they will be designed one by one.' : 'No components found.'}
          </p>
        )}
      </div>

      {/*<p className="border-t border-sidebar-border p-4 text-xs leading-relaxed text-muted-foreground">*/}
      {/*  Drag a component onto the canvas and connect one's output to another's input.*/}
      {/*</p>*/}
    </aside>
  )
}
