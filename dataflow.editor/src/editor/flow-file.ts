import type { Edge, Node } from '@xyflow/react';
import { END, FLOW_FILE_VERSION, START, type FlowFile } from '@dataflow/core';
import type { ComponentData, ComponentNode } from './component-node';
import { GROUP_SIZE, GROUP_Z, type GroupData, type GroupNode } from './group';

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
          ...(data.pinned ? { pinned: data.pinned } : {}),
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

/** the core's flow file on the canvas (what the editor opens): groups first (behind), Start and End not deletable */
export function flowFileToCanvas(file: FlowFile): { nodes: (ComponentNode | GroupNode)[]; edges: Edge[] } {
  const groups: GroupNode[] = (file.groups ?? []).map(g => ({
    id: g.id,
    type: 'group',
    zIndex: GROUP_Z,
    position: g.position,
    width: g.size.width,
    height: g.size.height,
    data: { title: g.title, color: g.color },
  }));
  const components: ComponentNode[] = file.nodes.map(n => ({
    id: n.id,
    type: 'component',
    position: n.position,
    ...(n.type === START || n.type === END ? { deletable: false } : {}),
    data: {
      type: n.type,
      config: n.config,
      ...(n.label ? { label: n.label } : {}),
      ...(n.outputKey ? { outputKey: n.outputKey } : {}),
      ...(n.disabled ? { disabled: true } : {}),
      // a pin keeps its envelopes per port; a bare `true` of earlier versions had none: not pinned
      ...(n.pinned && typeof n.pinned === 'object' ? { pinned: n.pinned } : {}),
      ...(n.notes ? { notes: n.notes } : {}),
    },
  }));
  const edges: Edge[] = file.edges.map(e => ({
    id: `${e.source}:${e.sourcePort}->${e.target}:${e.targetPort}`,
    source: e.source,
    sourceHandle: e.sourcePort,
    target: e.target,
    targetHandle: e.targetPort,
  }));
  return { nodes: [...groups, ...components], edges };
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
