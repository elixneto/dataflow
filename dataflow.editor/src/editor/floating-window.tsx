import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Minus, Trash, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type WindowPosition = { x: number; y: number };
export type WindowSize = { w: number; h: number | null };

type ResizeEdge = 'right' | 'bottom' | 'corner';

const INITIAL_WIDTH = 384;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 180;

type Props = {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  position: WindowPosition;
  /** size remembered from last time (without it, the default) */
  initialSize?: WindowSize;
  z: number;
  active: boolean;
  onMove: (position: WindowPosition) => void;
  /** when an edge is released, with the final size */
  onResize?: (size: WindowSize) => void;
  onFocus: () => void;
  onClose: () => void;
  /** minimize button next to the X: the window hides (kept as it is, its size and unsaved edits too) */
  onMinimize?: () => void;
  /** minimized: hidden, not unmounted */
  minimized?: boolean;
  /** trash button next to the X (removes the component from the canvas) */
  onDelete?: () => void;
  label: string;
  children: ReactNode;
};

/**
 * A floating window over the canvas (a component's configuration), as in the PoC: dragged by its title, resized by the
 * right edge, the bottom edge or the corner, brought to the front on click, minimized, closed with X or Esc. Several
 * can be open.
 * It lives in a layer marked data-windows that covers the canvas.
 */
export function FloatingWindow(props: Props) {
  const { title, subtitle, icon, position, initialSize, z, active, onMove, onResize, onFocus, onClose, onMinimize, minimized, onDelete, label, children } = props;
  const windowRef = useRef<HTMLElement>(null);
  const drag = useRef<{ dx: number; dy: number; parent: DOMRect } | null>(null);
  const resizing = useRef<{ edge: ResizeEdge; x: number; y: number; w: number; h: number; parent: DOMRect } | null>(null);
  // height null = the content's (up to the canvas); it becomes fixed once resized
  const [size, setSize] = useState<WindowSize>(initialSize ?? { w: INITIAL_WIDTH, h: null });

  const layer = (element: HTMLElement) => (element.closest('[data-windows]') as HTMLElement).getBoundingClientRect();

  const startResize = (edge: ResizeEdge, event: PointerEvent<HTMLElement>) => {
    event.stopPropagation();
    resizing.current = { edge, x: event.clientX, y: event.clientY, w: size.w, h: windowRef.current?.offsetHeight ?? 400, parent: layer(event.currentTarget) };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const resize = (event: PointerEvent<HTMLElement>) => {
    const r = resizing.current;
    if (!r) {
      return;
    }

    const maxW = r.parent.width - position.x - 4;
    const maxH = r.parent.height - position.y - 4;
    setSize(current => ({
      w: r.edge === 'bottom' ? current.w : Math.min(Math.max(r.w + event.clientX - r.x, MIN_WIDTH), maxW),
      h: r.edge === 'right' ? current.h : Math.min(Math.max(r.h + event.clientY - r.y, MIN_HEIGHT), maxH),
    }));
  };

  const resizeHandle = (edge: ResizeEdge, className: string) => (
    <div
      aria-hidden
      onPointerDown={event => startResize(edge, event)}
      onPointerMove={resize}
      onPointerUp={() => {
        if (resizing.current) {
          onResize?.(size);
        }

        resizing.current = null;
      }}
      className={cn('absolute z-10 touch-none', className)}
    />
  );

  const startDrag = (event: PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button')) {
      return;
    }

    const parent = layer(event.currentTarget);
    drag.current = { dx: event.clientX - parent.left - position.x, dy: event.clientY - parent.top - position.y, parent };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const dragMove = (event: PointerEvent<HTMLElement>) => {
    const a = drag.current;
    if (!a) {
      return;
    }

    // the title stays inside the canvas (otherwise it could not be grabbed again)
    const x = Math.min(Math.max(event.clientX - a.parent.left - a.dx, -280), a.parent.width - 80);
    const y = Math.min(Math.max(event.clientY - a.parent.top - a.dy, 0), a.parent.height - 40);
    onMove({ x, y });
  };

  return (
    <section
      ref={windowRef}
      role="dialog"
      aria-label={label}
      onPointerDownCapture={onFocus}
      hidden={minimized}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          onClose();
        }
      }}
      className={cn(
        'nopan nowheel nodrag pointer-events-auto absolute flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-2xl',
        active ? 'border-primary/50' : 'border-border',
      )}
      style={{ left: position.x, top: position.y, zIndex: z, width: size.w, height: size.h ?? undefined, maxHeight: `calc(100% - ${position.y + 8}px)` }}
    >
      <header
        onPointerDown={startDrag}
        onPointerMove={dragMove}
        onPointerUp={() => (drag.current = null)}
        className="flex shrink-0 cursor-grab touch-none items-center gap-3 border-b px-4 py-3 select-none active:cursor-grabbing"
      >
        {icon}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{title}</span>
          {subtitle && <span className="truncate text-xs text-muted-foreground">{subtitle}</span>}
        </div>
        {onDelete && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onDelete}
            aria-label="Remove component"
            title="Remove component"
            className="text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
          >
            <Trash />
          </Button>
        )}
        {onMinimize && (
          <Button variant="ghost" size="icon-sm" onClick={onMinimize} aria-label="Minimize window" title="Minimize">
            <Minus />
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close window" title="Close (Esc)">
          <X />
        </Button>
      </header>
      {children}
      {resizeHandle('right', 'inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-primary/30')}
      {resizeHandle('bottom', 'inset-x-0 bottom-0 h-1.5 cursor-ns-resize hover:bg-primary/30')}
      {resizeHandle('corner', 'right-0 bottom-0 size-4 cursor-nwse-resize rounded-br-xl')}
    </section>
  );
}
