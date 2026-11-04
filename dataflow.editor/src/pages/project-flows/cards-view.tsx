import { Folder as FolderIcon, Workflow } from 'lucide-react';
import { Link } from 'react-router';
import { flowPath } from '@/app/paths';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ProjectContents } from '@/data/flows/flow';
import { childrenOf, itemCount } from '@/data/flows/project-tree';
import { formatDateTime } from '@/lib/format';
import { relativeTime } from '@/lib/relative-time';
import { FlowMenu, FolderMenu, type ItemActions } from './item-menus';

type Props = {
  contents: ProjectContents;
  projectId: string;
  /** the folder being shown; null = the project's root */
  folderId: string | null;
  actions: ItemActions;
};

const CARD = 'relative transition-colors hover:bg-accent/40 focus-within:ring-2 focus-within:ring-ring';
/** the link covers the whole card (after:inset-0); the "..." menu sits above it */
const COVER = "outline-none after:absolute after:inset-0 after:content-['']";

/** One folder's contents as cards: its folders first (a click goes into them), then its flows. */
export function CardsView({ contents, projectId, folderId, actions }: Props) {
  const { folders, flows } = childrenOf(contents, folderId);
  if (folders.length === 0 && flows.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-12 text-center">
        <FolderIcon className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{folderId ? 'This folder is empty.' : 'No flows yet.'}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {folders.map(folder => {
        const count = itemCount(contents, folder.id);
        return (
          <Card key={folder.id} className={CARD}>
            <CardHeader className="flex items-center gap-3">
              <FolderIcon className="size-5 shrink-0 text-muted-foreground" />
              <div className="grid min-w-0 flex-1 gap-1">
                <CardTitle className="truncate">
                  <button type="button" className={`text-left ${COVER}`} onClick={() => actions.openFolder(folder.id)}>
                    {folder.name}
                  </button>
                </CardTitle>
                <CardDescription>{count === 1 ? '1 item' : `${count} items`}</CardDescription>
              </div>
              <FolderMenu folder={folder} actions={actions} className="-mr-2" />
            </CardHeader>
          </Card>
        );
      })}

      {flows.map(flow => (
        <Card key={flow.id} className={CARD}>
          <CardHeader className="flex items-center gap-3">
            <Workflow className="size-5 shrink-0 text-muted-foreground" />
            <div className="grid min-w-0 flex-1 gap-1">
              <CardTitle className="truncate">
                <Link to={flowPath(projectId, flow.id)} className={COVER}>
                  {flow.name}
                </Link>
              </CardTitle>
              <CardDescription className="truncate" title={formatDateTime(flow.updatedAt)}>
                Updated {relativeTime(flow.updatedAt)} by {flow.updatedByName ?? flow.updatedBy}
              </CardDescription>
            </div>
            <FlowMenu flow={flow} actions={actions} className="-mr-2" />
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}
