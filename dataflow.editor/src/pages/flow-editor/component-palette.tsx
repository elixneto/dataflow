import { useId, useState, type CSSProperties } from 'react';
import { Blocks, ChevronDown, GripVertical, Search } from 'lucide-react';
import { Panel } from '@xyflow/react';
import { Input } from '@/components/ui/input';
import { CATEGORIES, paletteSections } from '@/editor/catalog';
import { COMPONENT_DRAG_TYPE } from '@/editor/drag';
import { cn } from '@/lib/utils';
import { readPaletteOpen, savePaletteOpen } from '@/lib/view-preference';

/** the category's color, and a tint of it for the icon tiles (as in the PoC) */
const categoryStyle = (color: string) =>
  ({ '--category': color, '--category-tint': `color-mix(in oklch, ${color} 15%, transparent)` }) as CSSProperties;

/**
 * The components panel, floating over the canvas in its top-left corner. It opens and closes vertically (remembered
 * in this browser); open, it lists the components by category with a search, in the PoC's style: each category's
 * name in its color, each component a card with its icon on a tinted tile, its name and description. nopan/nowheel/
 * nodrag keep the canvas from panning or zooming while the pointer is over it.
 */
export function ComponentPalette() {
  const [open, setOpen] = useState(readPaletteOpen);
  const [search, setSearch] = useState('');
  const contentId = useId();
  const sections = paletteSections(search);

  const toggle = () => {
    setOpen(!open);
    savePaletteOpen(!open);
  };

  return (
    <Panel position="top-left" className="nopan nowheel nodrag" style={{ margin: 12 }}>
      <div className="flex max-h-[calc(100svh-5.5rem)] w-72 flex-col overflow-hidden rounded-lg border bg-card shadow-md">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={contentId}
          className="flex h-10 shrink-0 items-center gap-2 px-3 text-sm font-medium outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Blocks className="size-4 text-muted-foreground" />
          Components
          <ChevronDown className={cn('ml-auto size-4 text-muted-foreground transition-transform', !open && '-rotate-90')} />
        </button>

        {/* opens and closes vertically: the grid row goes from 0fr to 1fr */}
        <div
          id={contentId}
          className={cn('grid min-h-0 transition-[grid-template-rows] duration-200', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}
          inert={!open}
        >
          <div className="flex min-h-0 flex-col overflow-hidden">
            <div className="relative shrink-0 border-t p-3">
              <Search className="pointer-events-none absolute top-1/2 left-5.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search..." aria-label="Search components" className="h-9 pl-8" />
            </div>

            <div className="flex min-h-0 flex-col gap-5 overflow-y-auto px-3 pb-3 [&>*]:shrink-0">
              {sections.length === 0 && <p className="text-sm text-muted-foreground">No components found.</p>}
              {sections.map(({ category, components }) => {
                const { label, color } = CATEGORIES[category];
                return (
                  <section key={category} className="flex flex-col gap-2" style={categoryStyle(color)} aria-labelledby={`palette-${category}`}>
                    <h3
                      id={`palette-${category}`}
                      className="flex items-center gap-2 font-mono text-xs tracking-wider text-[var(--category)] uppercase"
                    >
                      <span className="size-2 rounded-sm border border-[var(--category)] bg-[var(--category-tint)]" aria-hidden />
                      {label}
                    </h3>
                    <ul className="flex flex-col gap-1.5">
                      {components.map(component => (
                        // dragged onto the canvas, it adds the component where it is dropped
                        <li
                          key={component.type}
                          draggable
                          onDragStart={event => {
                            event.dataTransfer.setData(COMPONENT_DRAG_TYPE, component.type);
                            event.dataTransfer.effectAllowed = 'copy';
                          }}
                          className="group flex cursor-grab items-center gap-3 rounded-md border border-transparent bg-accent/50 p-2 transition-colors hover:border-border hover:bg-accent active:cursor-grabbing"
                        >
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--category-tint)] text-[var(--category)]">
                            <component.icon className="size-4" aria-hidden />
                          </div>
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-sm font-medium">{component.label}</span>
                            <span className="truncate text-xs text-muted-foreground" title={component.description}>
                              {component.description}
                            </span>
                          </div>
                          <GripVertical className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}
