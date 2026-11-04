import { memo } from 'react';
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { GROUP_COLORS, type GroupData, type GroupNode } from './group';

/*
 * A group, as in the PoC: a colored rectangle behind the components, only to organize them visually (it is not part of
 * the run). It has a title and a color; selected, it can be resized and recolored. Dragging it takes along the cards
 * entirely inside it (flow-canvas.tsx).
 */

function GroupNodeView({ id, data, selected }: NodeProps<GroupNode>) {
  const { updateNodeData } = useReactFlow<GroupNode>();
  const set = (changes: Partial<GroupData>) => updateNodeData(id, changes);

  return (
    <>
      <NodeResizer isVisible={selected} minWidth={160} minHeight={96} color={data.color} />
      <div
        className="absolute inset-0 flex flex-col rounded-xl border-2"
        style={{
          backgroundColor: `color-mix(in oklch, ${data.color} 16%, transparent)`,
          borderColor: `color-mix(in oklch, ${data.color} ${selected ? 90 : 45}%, transparent)`,
        }}
      >
        <header className="flex shrink-0 items-center gap-2 px-3 py-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Group title</span>
            <input
              value={data.title}
              onChange={event => set({ title: event.target.value })}
              placeholder="Group"
              style={{ color: `color-mix(in oklch, ${data.color} 70%, var(--foreground))` }}
              className="nodrag w-full truncate rounded bg-transparent px-1 text-sm font-semibold outline-none placeholder:opacity-60 focus-visible:bg-background"
            />
          </label>
          {selected && (
            <div className="nodrag flex shrink-0 items-center gap-1" role="radiogroup" aria-label="Group color">
              {GROUP_COLORS.map(color => (
                <button
                  key={color}
                  type="button"
                  role="radio"
                  aria-checked={color === data.color}
                  aria-label={`Color ${color}`}
                  onClick={() => set({ color })}
                  style={{ backgroundColor: color }}
                  className={cn(
                    'size-4 rounded-full border border-background',
                    color === data.color && 'ring-2 ring-foreground/60 ring-offset-1 ring-offset-background',
                  )}
                />
              ))}
              <label
                className="relative flex size-4 cursor-pointer items-center justify-center overflow-hidden rounded-full border"
                title="Other color"
                style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}
              >
                <span className="sr-only">Other color</span>
                <input type="color" value={data.color} onChange={event => set({ color: event.target.value })} className="absolute inset-0 cursor-pointer opacity-0" />
              </label>
            </div>
          )}
        </header>
      </div>
    </>
  );
}

export const GroupNodeMemo = memo(GroupNodeView);
