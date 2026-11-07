import { Archive, Copy, Ellipsis, FolderInput, FolderPlus, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Flow, Folder } from '@/data/flows/flow';
import { cn } from '@/lib/utils';

/** What the folder and flow menus can ask the page to do (the page opens the dialogs). */
export type ItemActions = {
  openFolder: (folderId: string) => void;
  newFolder: (parentId: string | null) => void;
  newFlow: (folderId: string | null) => void;
  rename: (kind: 'folder' | 'flow', item: Folder | Flow) => void;
  move: (kind: 'folder' | 'flow', item: Folder | Flow) => void;
  clone: (flow: Flow) => void;
  archive: (kind: 'folder' | 'flow', item: Folder | Flow) => void;
};

function MenuButton({ name, className }: { name: string; className?: string }) {
  return (
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="icon" className={cn('relative z-10 size-8 shrink-0', className)} aria-label={`Actions for ${name}`}>
        <Ellipsis />
      </Button>
    </DropdownMenuTrigger>
  );
}

/** "..." of a folder: New flow here, New folder here, Rename, Move to..., Archive. */
export function FolderMenu({ folder, actions, className }: { folder: Folder; actions: ItemActions; className?: string }) {
  return (
    <DropdownMenu>
      <MenuButton name={folder.name} className={className} />
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => actions.newFlow(folder.id)}>
          <Plus /> New flow here
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.newFolder(folder.id)}>
          <FolderPlus /> New folder here
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => actions.rename('folder', folder)}>
          <Pencil /> Rename
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.move('folder', folder)}>
          <FolderInput /> Move to...
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.archive('folder', folder)}>
          <Archive /> Archive
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "..." of a flow: Rename, Move to..., Clone..., Archive. */
export function FlowMenu({ flow, actions, className }: { flow: Flow; actions: ItemActions; className?: string }) {
  return (
    <DropdownMenu>
      <MenuButton name={flow.name} className={className} />
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => actions.rename('flow', flow)}>
          <Pencil /> Rename
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.move('flow', flow)}>
          <FolderInput /> Move to...
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.clone(flow)}>
          <Copy /> Clone...
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.archive('flow', flow)}>
          <Archive /> Archive
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
