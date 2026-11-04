import { lazy, Suspense, useState } from 'react';
import { useParams } from 'react-router';
import { ChevronRight, Copy, Ellipsis, FileCode2, Folder, FolderOpen, FolderPlus, LoaderCircle, Pencil, Plus, Trash } from 'lucide-react';
import { scriptImport } from '@dataflow/core';
import { ConfirmDialog, type ConfirmTarget } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { isReadOnly, useProject } from '@/data/projects/use-project';
import {
  createFolder,
  createScript,
  deleteScriptPath,
  newPathIssue,
  renameScriptPath,
  scriptFolders,
  useProjectScripts,
} from '@/data/scripts/scripts-mock';
import { cn } from '@/lib/utils';
import { ProjectPage } from '@/pages/project/project-page';
import { PathDialog, type PathDialogTarget } from './path-dialog';

// Monaco only when a script is open
const ScriptEditor = lazy(() => import('./script-editor'));

/** a line of the tree: a folder or a script, at its depth */
type Row = { kind: 'folder' | 'script'; path: string; name: string; depth: number };

/** the folders and scripts in tree order (a folder before what it holds), only under open folders */
function treeRows(folders: string[], scripts: string[], open: Set<string>): Row[] {
  const rows: Row[] = [];
  const childrenOf = (parent: string) => {
    const depth = parent ? parent.split('/').length : 0;
    const direct = (path: string) => path.split('/').length === depth + 1 && (!parent || path.startsWith(`${parent}/`));
    return {
      folders: folders.filter(direct),
      scripts: scripts.filter(direct),
    };
  };
  const walk = (parent: string) => {
    const { folders: subfolders, scripts: files } = childrenOf(parent);
    const depth = parent ? parent.split('/').length : 0;
    for (const folder of subfolders) {
      rows.push({ kind: 'folder', path: folder, name: folder.split('/').at(-1)!, depth });
      if (open.has(folder)) {
        walk(folder);
      }
    }

    for (const script of files) {
      rows.push({ kind: 'script', path: script, name: script.split('/').at(-1)!, depth });
    }
  };
  walk('');
  return rows;
}

/**
 * A project's scripts (/projects/:projectId/scripts), MOCKED for now (kept in this tab's memory): TypeScript modules in
 * nested folders that a TypeScript component imports by their path (`@myproject/scripts/<path>`). The tree on the left,
 * the selected script's code on the right.
 */
export function ScriptsPage() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const archived = isReadOnly(project);
  const scripts = useProjectScripts(projectId);
  const folders = scriptFolders(scripts);
  const [open, setOpen] = useState<Set<string>>(() => new Set(folders));
  const [selected, setSelected] = useState<string | null>(scripts.scripts[0]?.path ?? null);
  const [dialog, setDialog] = useState<PathDialogTarget | null>(null);
  const [confirm, setConfirm] = useState<ConfirmTarget | null>(null);
  const [copied, setCopied] = useState(false);
  const script = scripts.scripts.find(s => s.path === selected) ?? null;

  const openAlong = (path: string) => setOpen(current => new Set([...current, ...path.split('/').map((_, i, parts) => parts.slice(0, i + 1).join('/'))]));
  const inFolder = (folder?: string) => (folder ? `${folder}/` : '');

  const newScript = (folder?: string) =>
    setDialog({
      title: 'New script',
      initial: inFolder(folder),
      submitLabel: 'Create',
      issue: path => newPathIssue(projectId, path),
      onSave: path => {
        setSelected(createScript(projectId, path));
        openAlong(path);
      },
    });
  const newFolder = (folder?: string) =>
    setDialog({
      title: 'New folder',
      initial: inFolder(folder),
      submitLabel: 'Create',
      issue: path => newPathIssue(projectId, path),
      onSave: path => {
        createFolder(projectId, path);
        openAlong(path);
      },
    });
  const rename = (row: Row) =>
    setDialog({
      title: row.kind === 'folder' ? 'Rename folder' : 'Rename script',
      initial: row.path,
      submitLabel: 'Rename',
      issue: path => (path.trim() === row.path ? null : newPathIssue(projectId, path)),
      onSave: path => {
        const to = renameScriptPath(projectId, row.path, path);
        if (selected && (selected === row.path || selected.startsWith(`${row.path}/`))) {
          setSelected(`${to}${selected.slice(row.path.length)}`);
        }
        openAlong(to);
      },
    });
  const remove = (row: Row) =>
    setConfirm({
      title: row.kind === 'folder' ? `Delete the folder ${row.path}?` : `Delete ${row.path}?`,
      description: row.kind === 'folder' ? 'The folder and every script in it are deleted.' : 'The script is deleted.',
      confirmLabel: 'Delete',
      busyLabel: 'Deleting…',
      destructive: true,
      onConfirm: async () => {
        deleteScriptPath(projectId, row.path);
        if (selected && (selected === row.path || selected.startsWith(`${row.path}/`))) {
          setSelected(null);
        }
        return { ok: true, value: null };
      },
    });

  const rows = treeRows(folders, scripts.scripts.map(s => s.path), open);
  const importLine = script ? scriptImport(script.path) : '';

  return (
    <ProjectPage
      projectId={projectId}
      project={project}
      tab="scripts"
      actions={
        <>
          <Button variant="outline" onClick={() => newFolder()}>
            <FolderPlus />
            New folder
          </Button>
          <Button onClick={() => newScript()}>
            <Plus />
            New script
          </Button>
        </>
      }
    >
      <div className="grid min-h-[60vh] grid-cols-[16rem_1fr] overflow-hidden rounded-lg border">
        <nav aria-label="Scripts" className="overflow-y-auto border-r bg-muted/30 py-2 text-sm">
          {rows.length === 0 && <p className="px-3 py-2 text-muted-foreground">No scripts.</p>}
          <ul>
            {rows.map(row => (
              <li key={`${row.kind}:${row.path}`} className="group flex items-center pr-1">
                <button
                  type="button"
                  aria-expanded={row.kind === 'folder' ? open.has(row.path) : undefined}
                  aria-current={row.kind === 'script' && row.path === selected ? 'true' : undefined}
                  onClick={() => {
                    if (row.kind === 'script') {
                      setSelected(row.path);
                      return;
                    }

                    setOpen(current => {
                      const next = new Set(current);
                      if (next.has(row.path)) {
                        next.delete(row.path);
                      } else {
                        next.add(row.path);
                      }

                      return next;
                    });
                  }}
                  style={{ paddingLeft: 8 + row.depth * 16 }}
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-accent',
                    row.kind === 'script' && row.path === selected && 'bg-accent font-medium',
                  )}
                >
                  {row.kind === 'folder' ? (
                    <>
                      <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open.has(row.path) && 'rotate-90')} />
                      {open.has(row.path) ? <FolderOpen className="size-4 shrink-0 text-muted-foreground" /> : <Folder className="size-4 shrink-0 text-muted-foreground" />}
                    </>
                  ) : (
                    <FileCode2 className="ml-5 size-4 shrink-0 text-sky-600 dark:text-sky-400" />
                  )}
                  <span className="truncate">{row.name}</span>
                </button>
                {!archived && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.path}`} className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100">
                        <Ellipsis />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {row.kind === 'folder' && (
                        <>
                          <DropdownMenuItem onSelect={() => newScript(row.path)}>
                            <Plus />
                            New script here
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => newFolder(row.path)}>
                            <FolderPlus />
                            New folder here
                          </DropdownMenuItem>
                        </>
                      )}
                      <DropdownMenuItem onSelect={() => rename(row)}>
                        <Pencil />
                        Rename or move
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onSelect={() => remove(row)}>
                        <Trash />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </li>
            ))}
          </ul>
        </nav>

        <section aria-label="Script" className="flex min-w-0 flex-col">
          {script ? (
            <>
              <header className="flex items-center gap-2 border-b px-3 py-2 text-sm">
                <span className="font-medium">{script.path}.ts</span>
                <span className="ml-auto text-xs text-muted-foreground">Import</span>
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{importLine}</code>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Copy the import path"
                  title={copied ? 'Copied' : 'Copy the import path'}
                  onClick={() => {
                    void navigator.clipboard?.writeText(importLine).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1200);
                    });
                  }}
                >
                  <Copy />
                </Button>
              </header>
              <div className="min-h-0 flex-1">
                <Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      <LoaderCircle className="size-4 animate-spin" />
                    </div>
                  }
                >
                  <ScriptEditor key={script.path} projectId={projectId} script={script} />
                </Suspense>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">No script selected.</div>
          )}
        </section>
      </div>

      <PathDialog target={dialog} onClose={() => setDialog(null)} />
      <ConfirmDialog target={confirm} onClose={() => setConfirm(null)} />
    </ProjectPage>
  );
}
