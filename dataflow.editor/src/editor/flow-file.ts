import type { Edge, Node } from '@xyflow/react';
import { FLOW_FILE_VERSION, type FlowFile } from '@dataflow/core';
import type { ComponentData } from './component-node';
import { GROUP_SIZE, type GroupData } from './group';

/** the canvas as the core's flow file (what Download gives): components, edges with their ports, groups */
export function canvasToFlowFile(flow: { id?: string; name: string }, nodes: Node[], edges: Edge[]): FlowFile {
  const groups = nodes.filter(n => n.type === 'group');
  return {
    version: FLOW_FILE_VERSION,
    ...(flow.id ? { id: flow.id } : {}),
    name: flow.name,
    nodes: nodes
      .filter(n => n.type === 'component')
      .map(n => {
        const data = n.data as ComponentData;
        return {
          id: n.id,
          type: data.type,
          ...(data.label?.trim() ? { label: data.label.trim() } : {}),
          position: n.position,
          config: data.config,
          ...(data.outputKey ? { outputKey: data.outputKey } : {}),
          ...(data.disabled ? { disabled: true } : {}),
          ...(data.pinned ? { pinned: true } : {}),
          ...(data.notes ? { notes: data.notes } : {}),
        };
      }),
    edges: edges.map(e => ({ source: e.source, sourcePort: e.sourceHandle ?? 'out-0', target: e.target, targetPort: e.targetHandle ?? 'in-0' })),
    ...(groups.length
      ? {
          groups: groups.map(g => ({
            id: g.id,
            title: (g.data as GroupData).title,
            color: (g.data as GroupData).color,
            position: g.position,
            size: {
              width: g.measured?.width ?? g.width ?? GROUP_SIZE.width,
              height: g.measured?.height ?? g.height ?? GROUP_SIZE.height,
            },
          })),
        }
      : {}),
  };
}

/** gives the browser a file to save */
export function saveFile(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
