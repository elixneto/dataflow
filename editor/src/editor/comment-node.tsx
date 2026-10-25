import {memo} from 'react';
import {NodeResizer, useReactFlow, type Node, type NodeProps} from '@xyflow/react';
import {ChevronDown, ChevronRight, MessageSquareText} from 'lucide-react';
import {cn} from '#lib/utils';
import {useHistory} from '#editor/history';

export type CommentData = {
  title: string;
  text: string;
  collapsed: boolean;
  expandedHeight?: number;
};

export type CommentNode = Node<CommentData, 'comment'>;

export const COMMENT_SIZE = {width: 280, height: 160};

function CommentNodeView({id, data, selected, height}: NodeProps<CommentNode>) {
  const {updateNodeData, updateNode} = useReactFlow<CommentNode>();
  const {record, recordEdit} = useHistory();

  function toggle() {
    record();
    if (data.collapsed) {
      updateNode(id, node => ({height: node.data.expandedHeight ?? COMMENT_SIZE.height, data: {...node.data, collapsed: false}}));
    } else {
      updateNode(id, node => ({height: undefined, data: {...node.data, collapsed: true, expandedHeight: height ?? COMMENT_SIZE.height}}));
    }
  }

  function setField(key: 'title' | 'text', value: string) {
    recordEdit(`${id}:${key}`);
    updateNodeData(id, {[key]: value});
  }

  const preview = data.text.split('\n')[0];

  return (
    <>
      <NodeResizer isVisible={selected && !data.collapsed} minWidth={200} minHeight={100} color="var(--comment)" onResizeStart={record}/>
      <div className={cn('flex flex-col overflow-hidden rounded-xl border border-dashed bg-comment/30 text-foreground transition-colors',
        data.collapsed ? 'h-auto w-full' : 'absolute inset-0 contain-strict',
        selected ? 'border-comment' : 'border-comment/50')}>
        <header className="flex shrink-0 items-center gap-1.5 px-2 py-2">
          <button type="button" onClick={toggle} aria-expanded={!data.collapsed}
                  aria-label={data.collapsed ? 'Expand comment' : 'Collapse comment'}
                  className="nodrag flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">
            {data.collapsed ? <ChevronRight className="size-3.5" aria-hidden="true"/> : <ChevronDown className="size-3.5" aria-hidden="true"/>}
          </button>
          <MessageSquareText className="size-3.5 shrink-0 text-comment" aria-hidden="true"/>
          <label className="min-w-0 flex-1">
            <span className="sr-only">Comment title</span>
            <input value={data.title} onChange={e => setField('title', e.target.value)} placeholder="Comment"
                   className="nodrag w-full truncate rounded bg-transparent px-1 text-sm font-semibold outline-none placeholder:text-muted-foreground focus-visible:bg-background"/>
          </label>
        </header>
        {data.collapsed ? (
          preview && <p className="truncate border-t border-dashed border-comment/40 px-3 py-1.5 text-[13px] text-muted-foreground">{preview}</p>
        ) : (
          <label className="flex min-h-0 flex-1 border-t border-dashed border-comment/40">
            <span className="sr-only">Comment text</span>
            <textarea value={data.text} onChange={e => setField('text', e.target.value)}
                      placeholder="Write a note about this part of the flow..."
                      className="nodrag nowheel h-full w-full resize-none bg-transparent px-3 py-2 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground"/>
          </label>
        )}
      </div>
    </>
  );
}

export const CommentNodeMemo = memo(CommentNodeView);
