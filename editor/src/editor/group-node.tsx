import {memo} from 'react'
import {NodeResizer, useReactFlow, type Node, type NodeProps} from '@xyflow/react'
import {cn} from '@/lib/utils'
import {useHistory} from './history'

/** Colored rectangle behind the components, only to group them visually (not part of the run). */
export type GroupData = {
  title: string
  color: string
}

export type GroupNode = Node<GroupData, 'group'>

export const GROUP_SIZE = {width: 600, height: 360}

export const GROUP_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#14b8a6', '#64748b']

/** Stays behind the edges and the components. */
export const GROUP_Z = -1

function GroupNodeView({id, data, selected}: NodeProps<GroupNode>) {
  const {updateNodeData} = useReactFlow<GroupNode>()
  const {record, recordEdit} = useHistory()

  function setField(key: keyof GroupData, value: string) {
    recordEdit(`${id}:${key}`)
    updateNodeData(id, {[key]: value})
  }

  return (
    <>
      <NodeResizer isVisible={selected} minWidth={160} minHeight={100} color={data.color} onResizeStart={record}/>
      <div className="absolute inset-0 flex flex-col rounded-xl border-2"
           style={{
             backgroundColor: `color-mix(in oklch, ${data.color} 16%, transparent)`,
             borderColor: `color-mix(in oklch, ${data.color} ${selected ? 90 : 45}%, transparent)`,
           }}>
        <header className="flex shrink-0 items-center gap-2 px-3 py-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Group title</span>
            <input value={data.title} onChange={e => setField('title', e.target.value)} placeholder="Group"
                   style={{color: `color-mix(in oklch, ${data.color} 70%, var(--foreground))`}}
                   className="nodrag w-full truncate rounded bg-transparent px-1 text-sm font-semibold outline-none placeholder:opacity-60 focus-visible:bg-background"/>
          </label>
          {selected && (
            <div className="nodrag flex shrink-0 items-center gap-1" role="radiogroup" aria-label="Group color">
              {GROUP_COLORS.map(color => (
                <button key={color} type="button" role="radio" aria-checked={color === data.color} aria-label={`Color ${color}`}
                        onClick={() => setField('color', color)} style={{backgroundColor: color}}
                        className={cn('size-4 rounded-full border border-background', color === data.color && 'ring-2 ring-foreground/60 ring-offset-1 ring-offset-background')}/>
              ))}
              <label className="relative flex size-4 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-border"
                     title="Other color" style={{background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)'}}>
                <span className="sr-only">Other color</span>
                <input type="color" value={data.color} onChange={e => setField('color', e.target.value)} className="absolute inset-0 cursor-pointer opacity-0"/>
              </label>
            </div>
          )}
        </header>
      </div>
    </>
  )
}

export const GroupNodeMemo = memo(GroupNodeView)
