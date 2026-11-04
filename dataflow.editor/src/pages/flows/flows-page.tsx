import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Archive, FolderOpen, Plus, RotateCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ArchiveDialog } from '@/components/archive-dialog';
import { StatusFilter } from '@/components/status-filter';
import { Skeleton } from '@/components/ui/skeleton';
import type { NewProject, Project } from '@/data/projects/project';
import type { ProjectStatus } from '@/data/projects/projects-api';
import { useProjects } from '@/data/projects/use-projects';
import { ProjectCard } from './project-card';
import { ProjectDialog, type ProjectDialogTarget } from './project-dialog';

/** only the fields the edit changed, so the request says what changed */
function changedFields(project: Project, fields: NewProject): Partial<NewProject> {
  const keys = ['name', 'description', 'icon', 'color'] as const;
  return Object.fromEntries(keys.filter(key => project[key] !== fields[key]).map(key => [key, fields[key]]));
}

/**
 * The organization's projects (from dataflow.server): Active or Archived (?status=archived in the URL, so a reload keeps
 * it), the button to create one, and each card's menu to edit, archive or restore.
 */
export function FlowsPage() {
  const [params, setParams] = useSearchParams();
  const status: ProjectStatus = params.get('status') === 'archived' ? 'archived' : 'active';
  const { state, reload, create, update, archive, restore } = useProjects(status);
  const projects = state.status === 'ready' ? state.projects : [];

  const [dialog, setDialog] = useState<ProjectDialogTarget | null>(null);
  const [archiving, setArchiving] = useState<Project | null>(null);
  /** a failed restore (e.g. an active project took the name) */
  const [notice, setNotice] = useState('');

  const changeStatus = (value: ProjectStatus) => {
    setNotice('');
    setParams(value === 'archived' ? { status: 'archived' } : {});
  };

  const save = (fields: NewProject) =>
    dialog?.mode === 'edit' ? update(dialog.project.id, changedFields(dialog.project, fields)) : create(fields);

  const restoreProject = async (project: Project) => {
    setNotice('');
    const result = await restore(project.id);
    if (!result.ok) {
      setNotice(result.error.message);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-6">
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <StatusFilter value={status} onChange={changeStatus} idPrefix="projects" />
        </div>
        {status === 'active' && (
          <Button onClick={() => setDialog({ mode: 'create' })}>
            <Plus /> New project
          </Button>
        )}
      </div>

      {notice && <p className="text-sm text-destructive">{notice}</p>}

      {state.status === 'loading' && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map(i => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      )}

      {state.status === 'error' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-12 text-center">
          <TriangleAlert className="size-8 text-destructive" />
          <p className="text-sm text-muted-foreground">{state.error.message}</p>
          <Button variant="outline" onClick={() => void reload()}>
            <RotateCw /> Try again
          </Button>
        </div>
      )}

      {state.status === 'ready' && projects.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-12 text-center">
          {status === 'active' ? <FolderOpen className="size-8 text-muted-foreground" /> : <Archive className="size-8 text-muted-foreground" />}
          <p className="text-sm text-muted-foreground">{status === 'active' ? 'No projects yet.' : 'No archived projects.'}</p>
        </div>
      )}

      {projects.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map(project => (
            <ProjectCard
              key={project.id}
              project={project}
              onEdit={() => setDialog({ mode: 'edit', project })}
              onArchive={() => setArchiving(project)}
              onRestore={() => void restoreProject(project)}
            />
          ))}
        </div>
      )}

      <ProjectDialog target={dialog} onClose={() => setDialog(null)} existing={projects} onSave={save} />
      <ArchiveDialog
        name={archiving?.name ?? null}
        onClose={() => setArchiving(null)}
        onArchive={() => archive(archiving!.id)}
      />
    </div>
  );
}
