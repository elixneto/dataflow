import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { ChevronsDownUp, ChevronsUpDown, FolderPlus, GitFork, LayoutGrid, ListTree, Plus, RotateCw, TriangleAlert } from 'lucide-react';
import { ArchiveDialog } from '@/components/archive-dialog';
import { SegmentedControl } from '@/components/segmented-control';
import { StatusFilter, type ListStatus } from '@/components/status-filter';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { Flow, Folder, ProjectContents } from '@/data/flows/flow';
import { folderPath, isFolderVisible, siblingNames } from '@/data/flows/project-tree';
import { useProjectContents } from '@/data/flows/use-project-contents';
import { useProject } from '@/data/projects/use-project';
import type { ApiResult } from '@/lib/api';
import { readProjectView, saveProjectView, type ProjectView } from '@/lib/view-preference';
import { ProjectPage } from '@/pages/project/project-page';
import { ArchivedList } from './archived-list';
import { CardsView } from './cards-view';
import { GraphView } from './graph-view';
import type { ItemActions } from './item-menus';
import { MoveDialog, type MoveTarget } from './move-dialog';
import { NameDialog, type NameDialogTarget } from './name-dialog';
import { TreeView } from './tree-view';

/** the Tree / Cards choice: the last one saved in this browser shows first (view-preference.ts) */
function useView(): [ProjectView, (view: ProjectView) => void] {
  const [view, setView] = useState<ProjectView>(readProjectView);
  const change = (next: ProjectView) => {
    setView(next);
    saveProjectView(next);
  };

  return [view, change];
}

/**
 * A project's folders and flows (/projects/:projectId/flows), from dataflow.server (data/flows/flows-api.ts). Tree or Cards
 * (remembered), Active or Archived (?status=archived),
 * and in Cards the folder being shown (?folder=<id>).
 */
export function ProjectFlowsPage() {
  const { projectId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const status: ListStatus = params.get('status') === 'archived' ? 'archived' : 'active';
  const [view, setView] = useView();
  const project = useProject(projectId);
  const store = useProjectContents(projectId);
  const contents: ProjectContents = store.state.status === 'ready' ? store.state.contents : { folders: [], flows: [] };

  // the folder shown in Cards; one that is gone or archived shows the root
  const requestedFolder = params.get('folder');
  const folderId = requestedFolder && isFolderVisible(contents.folders, requestedFolder) ? requestedFolder : null;
  const path = folderPath(contents.folders, folderId);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [naming, setNaming] = useState<NameDialogTarget | null>(null);
  const [moving, setMoving] = useState<MoveTarget | null>(null);
  const [archiving, setArchiving] = useState<{ kind: 'folder' | 'flow'; id: string; name: string } | null>(null);
  /** a failed restore (e.g. the name is taken where it goes back) */
  const [notice, setNotice] = useState('');

  const changeParams = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
    }

    setParams(next);
  };

  /** "In Imports / Daily" for the dialogs */
  const describe = (parentId: string | null) => {
    const where = folderPath(contents.folders, parentId).map(f => f.name).join(' / ');
    return where ? `In ${where}` : 'At the project root';
  };

  const allFolderIds = () => new Set(contents.folders.map(f => f.id));

  const actions: ItemActions = {
    openFolder: id => changeParams({ folder: id }),
    newFolder: parentId =>
      setNaming({
        title: 'New folder',
        description: describe(parentId),
        initial: '',
        submitLabel: 'Create',
        siblings: siblingNames(contents, 'folder', parentId),
        onSave: async name => {
          const result = await store.createFolder(parentId, name);
          if (result.ok && parentId) {
            setExpanded(current => new Set(current).add(parentId));
          }

          return result;
        },
      }),
    newFlow: folder =>
      setNaming({
        title: 'New flow',
        description: describe(folder),
        initial: '',
        submitLabel: 'Create',
        siblings: siblingNames(contents, 'flow', folder),
        onSave: async name => {
          const result = await store.createFlow(folder, name);
          if (result.ok && folder) {
            setExpanded(current => new Set(current).add(folder));
          }

          return result;
        },
      }),
    rename: (kind, item) => {
      const parentId = kind === 'folder' ? (item as Folder).parentId : (item as Flow).folderId;
      setNaming({
        title: kind === 'folder' ? 'Rename folder' : 'Rename flow',
        initial: item.name,
        submitLabel: 'Save',
        siblings: siblingNames(contents, kind, parentId, item.id),
        onSave: name => (kind === 'folder' ? store.renameFolder(item.id, name) : store.renameFlow(item.id, name)),
      });
    },
    move: (kind, item) =>
      setMoving({
        kind,
        id: item.id,
        name: item.name,
        currentFolderId: kind === 'folder' ? (item as Folder).parentId : (item as Flow).folderId,
      }),
    archive: (kind, item) => setArchiving({ kind, id: item.id, name: item.name }),
  };

  const move = (target: MoveTarget, to: string | null): Promise<ApiResult<unknown>> =>
    target.kind === 'folder' ? store.moveFolder(target.id, to) : store.moveFlow(target.id, to);

  const restore = async (kind: 'folder' | 'flow', id: string) => {
    setNotice('');
    const result = kind === 'folder' ? await store.restoreFolder(id) : await store.restoreFlow(id);
    if (!result.ok) {
      setNotice(result.error.message);
    }
  };

  const toggle = (id: string) =>
    setExpanded(current => {
      const next = new Set(current);
      if (!next.delete(id)) {
        next.add(id);
      }

      return next;
    });

  // where New folder / New flow put things: the folder shown in Cards; the root in Tree (folders have "... > New ... here")
  const createIn = view === 'cards' ? folderId : null;

  return (
    <ProjectPage
      projectId={projectId}
      project={project}
      tab="flows"
      folders={view === 'cards' && status === 'active' ? path : []}
      actions={
        status === 'active' && (
          <>
            <Button variant="outline" onClick={() => actions.newFolder(createIn)}>
              <FolderPlus /> New folder
            </Button>
            <Button onClick={() => actions.newFlow(createIn)}>
              <Plus /> New flow
            </Button>
          </>
        )
      }
    >
      <StatusFilter value={status} onChange={value => changeParams({ status: value === 'archived' ? 'archived' : null })} idPrefix="flows" />

      {/* the view on the left, always in the same place; Expand / Collapse (Tree only) on the right */}
      {status === 'active' && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <SegmentedControl
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: 'tree', label: 'Tree', icon: ListTree },
              { value: 'cards', label: 'Cards', icon: LayoutGrid },
              { value: 'graph', label: 'Graph', icon: GitFork },
            ]}
          />
          {view === 'tree' && (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => setExpanded(allFolderIds())}>
                <ChevronsUpDown /> Expand all
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setExpanded(new Set())}>
                <ChevronsDownUp /> Collapse all
              </Button>
            </div>
          )}
        </div>
      )}

      {notice && <p className="text-sm text-destructive">{notice}</p>}

      {store.state.status === 'loading' && (
        <div className="grid gap-2" aria-busy="true">
          {[0, 1, 2].map(i => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      )}

      {store.state.status === 'error' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-12 text-center">
          <TriangleAlert className="size-8 text-destructive" />
          <p className="text-sm text-muted-foreground">{store.state.error.message}</p>
          <Button variant="outline" onClick={() => void store.reload()}>
            <RotateCw /> Try again
          </Button>
        </div>
      )}

      {store.state.status === 'ready' && status === 'archived' && <ArchivedList contents={contents} onRestore={(kind, id) => void restore(kind, id)} />}
      {store.state.status === 'ready' && status === 'active' && view === 'cards' && (
        <CardsView contents={contents} projectId={projectId} folderId={folderId} actions={actions} />
      )}
      {store.state.status === 'ready' && status === 'active' && view === 'tree' && (
        <TreeView contents={contents} projectId={projectId} expanded={expanded} onToggle={toggle} actions={actions} />
      )}
      {store.state.status === 'ready' && status === 'active' && view === 'graph' && <GraphView projectId={projectId} />}

      <NameDialog target={naming} onClose={() => setNaming(null)} />
      <MoveDialog target={moving} contents={contents} onClose={() => setMoving(null)} onMove={move} />
      <ArchiveDialog
        name={archiving ? (archiving.kind === 'folder' ? `${archiving.name} and everything in it` : archiving.name) : null}
        onClose={() => setArchiving(null)}
        onArchive={() => (archiving!.kind === 'folder' ? store.archiveFolder(archiving!.id) : store.archiveFlow(archiving!.id))}
      />
    </ProjectPage>
  );
}
