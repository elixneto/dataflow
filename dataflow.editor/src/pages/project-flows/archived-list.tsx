import { Archive, ArchiveRestore, Folder as FolderIcon, Workflow } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ProjectContents } from '@/data/flows/flow';
import { archivedItems, folderPath } from '@/data/flows/project-tree';
import { formatDateTime } from '@/lib/format';
import { relativeTime } from '@/lib/relative-time';

type Props = {
  contents: ProjectContents;
  onRestore: (kind: 'folder' | 'flow', id: string) => void;
};

/** The archived folders and flows, last archived first, each with where it was and a Restore button. */
export function ArchivedList({ contents, onRestore }: Props) {
  const items = archivedItems(contents);
  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-12 text-center">
        <Archive className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Nothing archived.</p>
      </div>
    );
  }

  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card">
      {items.map(({ kind, item }) => {
        const parentId = kind === 'folder' ? item.parentId : item.folderId;
        const where = folderPath(contents.folders, parentId).map(f => f.name).join(' / ') || 'Project root';
        return (
          <li key={item.id} className="flex items-center gap-3 px-4 py-3 opacity-80">
            {kind === 'folder' ? <FolderIcon className="size-4 shrink-0 text-muted-foreground" /> : <Workflow className="size-4 shrink-0 text-muted-foreground" />}
            <div className="grid min-w-0 flex-1">
              <span className="truncate font-medium">{item.name}</span>
              <span className="truncate text-xs text-muted-foreground">In {where}</span>
            </div>
            <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline" title={formatDateTime(item.archivedAt!)}>
              Archived {relativeTime(item.archivedAt!)}
            </span>
            <Button variant="outline" size="sm" onClick={() => onRestore(kind, item.id)}>
              <ArchiveRestore /> Restore
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
