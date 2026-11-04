import { Maximize, Minus, Plus } from 'lucide-react';
import { Panel, useReactFlow, useViewport } from '@xyflow/react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** how long the zoom buttons animate (ms) */
const DURATION = 150;

/**
 * Zoom out, the current zoom in % (click: back to 100%), zoom in and fit the flow to the screen. Bottom right, left of
 * the minimap (200 px wide, 15 px from the edge).
 */
export function ZoomControls() {
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow();
  const { zoom } = useViewport();

  return (
    <Panel position="bottom-right" className="nopan nowheel nodrag" style={{ margin: '0 227px 15px 0' }}>
      <div className="flex items-center gap-0.5 rounded-lg border bg-card p-1 shadow-md">
        <ZoomButton label="Zoom out" onClick={() => void zoomOut({ duration: DURATION })}>
          <Minus />
        </ZoomButton>
        <button
          type="button"
          title="Back to 100%"
          aria-label={`Zoom ${Math.round(zoom * 100)}%, back to 100%`}
          onClick={() => void zoomTo(1, { duration: DURATION })}
          className="h-7 w-12 rounded-md text-xs text-muted-foreground tabular-nums outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {Math.round(zoom * 100)}%
        </button>
        <ZoomButton label="Zoom in" onClick={() => void zoomIn({ duration: DURATION })}>
          <Plus />
        </ZoomButton>
        <ZoomButton label="Fit to screen" onClick={() => void fitView({ duration: DURATION, padding: 0.2 })}>
          <Maximize />
        </ZoomButton>
      </div>
    </Panel>
  );
}

function ZoomButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4',
      )}
    >
      {children}
    </button>
  );
}
