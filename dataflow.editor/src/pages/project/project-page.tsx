import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { FileCode2, FileStack, KeyRound, Plug, TriangleAlert, Workflow, type LucideIcon } from 'lucide-react';
import { projectTabPath, PROJECTS_PATH, type ProjectTab } from '@/app/paths';
import { Button } from '@/components/ui/button';
import type { Folder } from '@/data/flows/flow';
import { isReadOnly, type ProjectState } from '@/data/projects/use-project';
import { cn } from '@/lib/utils';
import { ProjectBreadcrumb } from '@/pages/project-flows/project-breadcrumb';

/** a tab marked soon shows disabled, with a "Soon" tag: it is coming, not there yet */
const TABS: { tab: ProjectTab; label: string; icon: LucideIcon; soon?: boolean }[] = [
  { tab: 'flows', label: 'Flows', icon: Workflow },
  { tab: 'scripts', label: 'Scripts', icon: FileCode2 },
  { tab: 'connections', label: 'Connections', icon: Plug },
  { tab: 'secrets', label: 'Secrets and Variables', icon: KeyRound },
  { tab: 'files', label: 'Files', icon: FileStack, soon: true },
];

type Props = {
  projectId: string;
  project: ProjectState;
  tab: ProjectTab;
  /** the Flows tab's folder path, after the project in the breadcrumb */
  folders?: Folder[];
  /** the tab's buttons (New ...), next to the breadcrumb; left out while the project is archived */
  actions?: ReactNode;
  children: ReactNode;
};

/**
 * Every tab of a project: the breadcrumb, the tab bar (Flows | Scripts | Connections | Secrets and Variables | Files) and the tab's
 * content.
 * An archived project is read-only: no buttons to add things.
 */
export function ProjectPage({ projectId, project, tab, folders, actions, children }: Props) {
  if (project.status === 'error') {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-3 text-center">
        <TriangleAlert className="size-8 text-destructive" />
        <p className="text-sm text-muted-foreground">{project.error.code === 'not-found' ? 'Project not found.' : project.error.message}</p>
        <Button variant="outline" asChild>
          <Link to={PROJECTS_PATH}>Back to projects</Link>
        </Button>
      </div>
    );
  }

  const archived = isReadOnly(project);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <ProjectBreadcrumb project={project.status === 'ready' ? project.project : null} folders={folders} />
        {!archived && actions && <div className="flex gap-2">{actions}</div>}
      </div>

      {/* the line under the tabs is an inset shadow, so the active tab's underline covers it without overflowing (no scrollbar) */}
      <nav aria-label="Project" className="-mt-2 flex gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] shadow-[inset_0_-1px_0_var(--border)]">
        {TABS.map(item =>
          item.soon ? (
            <span
              key={item.tab}
              aria-disabled="true"
              className="flex cursor-not-allowed items-center gap-2 border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground/60"
            >
              <item.icon className="size-4" />
              {item.label}
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">Soon</span>
            </span>
          ) : (
          <Link
            key={item.tab}
            to={projectTabPath(projectId, item.tab)}
            aria-current={item.tab === tab ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
              item.tab === tab ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <item.icon className="size-4" />
            {item.label}
          </Link>
          ),
        )}
      </nav>

      {archived && <p className="text-sm text-muted-foreground">This project is archived: restore it to make changes.</p>}

      {children}
    </div>
  );
}
