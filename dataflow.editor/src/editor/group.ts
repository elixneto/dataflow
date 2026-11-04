import type { Node } from '@xyflow/react';

/** a group on the canvas (group-node.tsx): a title and a color, only to organize the components visually */
export type GroupData = { title: string; color: string };

export type GroupNode = Node<GroupData, 'group'>;

export const GROUP_SIZE = { width: 640, height: 352 };

export const GROUP_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#14b8a6', '#64748b'];

/** behind the edges and the components */
export const GROUP_Z = -1;

/**
 * Groups stack by size: a smaller group is above a bigger one (and all are behind the components), so a group put
 * inside another can still be clicked, whatever order they were made in.
 */
export function layerGroups<T extends { type?: string; zIndex?: number; width?: number; height?: number; measured?: { width?: number; height?: number } }>(nodes: T[]): T[] {
  const area = (n: T) => (n.measured?.width ?? n.width ?? 0) * (n.measured?.height ?? n.height ?? 0);
  const bySize = nodes.filter(n => n.type === 'group').sort((a, b) => area(b) - area(a));
  if (bySize.length === 0) {
    return nodes;
  }

  const layer = new Map(bySize.map((n, i) => [n, GROUP_Z - bySize.length + 1 + i]));
  return nodes.map(n => {
    const z = layer.get(n);
    return z === undefined || n.zIndex === z ? n : { ...n, zIndex: z };
  });
}
