import { useRef, useState, type DragEvent } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { ChevronRight, Download, Ellipsis, FileText, FolderPlus, Folder as FolderIcon, HardDrive, LoaderCircle, Trash, Upload, Workflow } from 'lucide-react';
import { ConfirmDialog, type ConfirmTarget } from '@/components/confirm-dialog';
import { ResourceView } from '@/components/resource-view';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { createFileFolder, deleteFile, deleteFileFolder, listFiles, uploadFiles } from '@/data/files/mock-files-api';
import { allFolders, contentsOf, fileName, humanSize, join } from '@/data/files/project-file';
import { isReadOnly, useProject } from '@/data/projects/use-project';
import { useResource } from '@/data/use-resource';
import { formatDateTime } from '@/lib/format';
import { relativeTime } from '@/lib/relative-time';
import { cn } from '@/lib/utils';
import { ProjectPage } from '@/pages/project/project-page';
import { NameDialog, type NameDialogTarget } from '@/pages/project-flows/name-dialog';

/**
 * A project's Files (/projects/:projectId/files), MOCKED for now: blob storage that flows read and write. The folder
 * being shown is in the URL (?path=reports/2026); upload with the button or by dropping files on the list.
 */
export function FilesPage() {
  const { projectId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const project = useProject(projectId);
  const files = useResource(`files:${projectId}`, () => listFiles(projectId));
  const readOnly = isReadOnly(project);
  const input = useRef<HTMLInputElement>(null);

  const [naming, setNaming] = useState<NameDialogTarget | null>(null);
  const [confirm, setConfirm] = useState<ConfirmTarget | null>(null);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState('');

  const listing = files.state.status === 'ready' ? files.state.value : { files: [], folders: [] };
  const requested = params.get('path') ?? '';
  // a folder that is gone shows the root
  const folder = requested && files.state.status === 'ready' && !allFolders(listing).includes(requested) ? '' : requested;
  const open = (path: string) => setParams(path ? { path } : {});

  const upload = async (list: FileList | null) => {
    if (!list || list.length === 0 || readOnly) {
      return;
    }

    setNotice('');
    setUploading(list.length);
    const result = await files.run(uploadFiles(projectId, folder, [...list].map(f => ({ name: f.name, size: f.size, type: f.type }))));
    setUploading(0);
    if (!result.ok) {
      setNotice(result.error.message);
    }
  };

  const drop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void upload(event.dataTransfer.files);
  };

  const here = contentsOf(listing, folder);
  const steps = folder ? folder.split('/') : [];

  return (
    <ProjectPage
      projectId={projectId}
      project={project}
      tab="files"
      actions={
        <>
          <Button
            variant="outline"
            onClick={() =>
              setNaming({
                title: 'New folder',
                description: folder ? `In ${folder}` : 'At the root of Files',
                initial: '',
                submitLabel: 'Create',
                siblings: [...here.folders.map(name => ({ name })), ...here.files.map(f => ({ name: fileName(f.path) }))],
                onSave: name => files.run(createFileFolder(projectId, folder, name)),
              })
            }
          >
            <FolderPlus /> New folder
          </Button>
          <Button onClick={() => input.current?.click()} disabled={uploading > 0}>
            <Upload /> Upload
          </Button>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            onChange={event => {
              void upload(event.target.files);
              event.target.value = '';
            }}
          />
        </>
      }
    >
      {/* where we are in Files: Files › reports › 2026 */}
      <nav aria-label="Folder" className="flex flex-wrap items-center gap-1 text-sm">
        <button type="button" onClick={() => open('')} className={cn('flex items-center gap-1.5 hover:text-foreground', folder ? 'text-muted-foreground' : 'font-medium')}>
          <HardDrive className="size-4" /> Files
        </button>
        {steps.map((step, i) => {
          const path = steps.slice(0, i + 1).join('/');
          return (
            <span key={path} className="flex items-center gap-1">
              <ChevronRight className="size-4 text-muted-foreground" />
              <button type="button" onClick={() => open(path)} className={cn('hover:text-foreground', i < steps.length - 1 ? 'text-muted-foreground' : 'font-medium')}>
                {step}
              </button>
            </span>
          );
        })}
      </nav>

      {uploading > 0 && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" /> Uploading {uploading === 1 ? '1 file' : `${uploading} files`}…
        </p>
      )}
      {notice && <p className="text-sm text-destructive">{notice}</p>}

      <div
        onDragOver={event => {
          if (!readOnly) {
            event.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
        className={cn('flex flex-1 flex-col rounded-xl transition-shadow', dragging && 'ring-2 ring-primary ring-offset-2 ring-offset-background')}
      >
        <ResourceView
          state={files.state}
          onRetry={() => void files.reload()}
          empty={{ icon: FolderIcon, text: readOnly ? 'This folder is empty.' : 'This folder is empty. Drop files here to upload them.' }}
          isEmpty={value => {
            const inside = contentsOf(value, folder);
            return inside.folders.length === 0 && inside.files.length === 0;
          }}
        >
          {() => (
            <ul className="divide-y overflow-hidden rounded-xl border bg-card">
              {here.folders.map(name => {
                const path = join(folder, name);
                return (
                  <li key={path} className="relative flex items-center gap-3 px-4 py-3 hover:bg-accent/40">
                    <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                    <button
                      type="button"
                      onClick={() => open(path)}
                      className="min-w-0 flex-1 truncate text-left font-medium outline-none after:absolute after:inset-0 after:content-['']"
                    >
                      {name}
                    </button>
                    {!readOnly && (
                      <ItemMenu
                        name={name}
                        onDelete={() =>
                          setConfirm({
                            title: `Delete ${name} and everything in it?`,
                            description: 'Flows that read these files will not find them. This cannot be undone.',
                            confirmLabel: 'Delete',
                            busyLabel: 'Deleting...',
                            destructive: true,
                            onConfirm: () => files.run(deleteFileFolder(projectId, path)),
                          })
                        }
                      />
                    )}
                  </li>
                );
              })}

              {here.files.map(file => {
                const name = fileName(file.path);
                return (
                  <li key={file.path} className="flex items-center gap-3 px-4 py-3">
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <div className="grid min-w-0 flex-1">
                      <span className="truncate font-medium">{name}</span>
                      <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                        {file.source === 'upload' ? (
                          <>Uploaded by {file.createdBy}</>
                        ) : (
                          <>
                            <Workflow className="size-3" /> Generated by {file.source.flowName}
                          </>
                        )}
                      </span>
                    </div>
                    <span className="hidden w-24 shrink-0 truncate text-xs text-muted-foreground sm:inline">{file.contentType}</span>
                    <span className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{humanSize(file.size)}</span>
                    <span className="hidden w-28 shrink-0 text-right text-xs text-muted-foreground md:inline" title={formatDateTime(file.createdAt)}>
                      {relativeTime(file.createdAt)}
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        {/* a disabled button gets no pointer events: the span carries the tooltip */}
                        <span>
                          <Button variant="ghost" size="icon" className="size-8" disabled aria-label={`Download ${name}`}>
                            <Download />
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Download is available when Files is connected to the server</TooltipContent>
                    </Tooltip>
                    {!readOnly && (
                      <ItemMenu
                        name={name}
                        onDelete={() =>
                          setConfirm({
                            title: `Delete ${name}?`,
                            description: 'Flows that read it will not find it. This cannot be undone.',
                            confirmLabel: 'Delete',
                            busyLabel: 'Deleting...',
                            destructive: true,
                            onConfirm: () => files.run(deleteFile(projectId, file.path)),
                          })
                        }
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </ResourceView>
      </div>

      <NameDialog target={naming} onClose={() => setNaming(null)} />
      <ConfirmDialog target={confirm} onClose={() => setConfirm(null)} />
    </ProjectPage>
  );
}

function ItemMenu({ name, onDelete }: { name: string; onDelete: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative z-10 size-8 shrink-0" aria-label={`Actions for ${name}`}>
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
