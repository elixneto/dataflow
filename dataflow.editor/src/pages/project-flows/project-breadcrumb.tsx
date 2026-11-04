import { Fragment, type ReactNode } from 'react';
import { ChevronRight, Ellipsis, Folder as FolderIcon } from 'lucide-react';
import { Link } from 'react-router';
import { projectPath, PROJECTS_PATH } from '@/app/paths';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import type { Folder } from '@/data/flows/flow';
import type { Project } from '@/data/projects/project';
import { cn } from '@/lib/utils';
import { ProjectIcon } from '@/pages/flows/project-icon';

type Props = {
  /** null while it loads */
  project: Project | null;
  /** the folders from the root down to the current one */
  folders?: Folder[];
  /** inside a flow: its name, last */
  flowName?: string;
};

type Step = { key: string; to: string; label: ReactNode };

const Separator = () => <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />;

const LINK = 'min-w-0 text-muted-foreground hover:text-foreground';

/** with more folders than this, the ones in the middle fold into "…" (a menu) */
const VISIBLE_FOLDERS = 2;

const folderLabel = (name: string) => (
  <span className="flex min-w-0 items-center gap-1.5">
    <FolderIcon className="size-4 shrink-0" />
    <span className="truncate">{name}</span>
  </span>
);

/**
 * Projects › <project icon in its color> Project › Folder › … › Folder › Flow, on one line: each step is a link, except
 * the last. Deep paths fold the middle folders into "…"; when it is still too long the steps are cut with "…", the
 * last one (the flow, or the folder you are in) always keeps at least 8 letters.
 */
export function ProjectBreadcrumb({ project, folders = [], flowName }: Props) {
  if (!project) {
    return (
      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-2 text-sm">
        <Link to={PROJECTS_PATH} className={cn(LINK, 'shrink-0')}>
          Projects
        </Link>
        <Separator />
        <Skeleton className="h-7 w-40" />
      </nav>
    );
  }

  const folded = folders.length > VISIBLE_FOLDERS ? folders.slice(1, -1) : [];
  const shown = folded.length > 0 ? [folders[0]!, folders.at(-1)!] : folders;

  const steps: Step[] = [
    {
      key: 'project',
      to: projectPath(project.id),
      label: (
        <span className="flex min-w-0 items-center gap-2">
          <ProjectIcon icon={project.icon} color={project.color} className="size-7 rounded-md [&_svg]:size-4" />
          <span className="truncate">{project.name}</span>
        </span>
      ),
    },
    ...shown.map(folder => ({ key: folder.id, to: projectPath(project.id, folder.id), label: folderLabel(folder.name) })),
    ...(flowName === undefined ? [] : [{ key: 'flow', to: '', label: <span className="block truncate">{flowName}</span> }]),
  ];

  // the "…" goes after the first folder (step 1 is the project)
  const foldAfter = folded.length > 0 ? 1 : -1;

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-sm">
      <Link to={PROJECTS_PATH} className={cn(LINK, 'shrink-0')}>
        Projects
      </Link>
      {steps.map((step, i) => (
        <Fragment key={step.key}>
          <Separator />
          {i === steps.length - 1 ? (
            // the last step: shrinks only after the others, never below 8 letters (9ch: 8 and the "…")
            <span className="max-w-full min-w-[9ch] shrink-[0.01] font-medium" aria-current="page" title={flowName ?? folders.at(-1)?.name ?? project.name}>
              {step.label}
            </span>
          ) : (
            <Link to={step.to} className={cn(LINK, 'max-w-48 min-w-7')} title={i === 0 ? project.name : shown[i - 1]?.name}>
              {step.label}
            </Link>
          )}
          {i === foldAfter && <FoldedFolders projectId={project.id} folders={folded} />}
        </Fragment>
      ))}
    </nav>
  );
}

/** "…": the folders between the first and the last, as a menu of links */
function FoldedFolders({ projectId, folders }: { projectId: string; folders: Folder[] }) {
  return (
    <>
      <Separator />
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${folders.length} more folders`}
        >
          <Ellipsis className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {folders.map(folder => (
            <DropdownMenuItem key={folder.id} asChild>
              <Link to={projectPath(projectId, folder.id)}>
                <FolderIcon /> {folder.name}
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
