import {useState, type FormEvent} from 'react';
import {Link, useNavigate} from 'react-router';
import {FolderKanban, Plus, Trash2, X} from 'lucide-react';
import {projectFlows} from '#mock/flows';
import {createProject, deleteProject, listProjects, type Project} from '#mock/projects';
import {Button} from '#ui/button';
import {fieldInput} from '#ui/expression-field';
import {cn} from '#lib/utils';
import {Header, shortDate} from '#pages/header';

/** Home page: the projects. Each project has flows, runs, secrets and files. */
export function ProjectList() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState(listProjects);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const project = createProject(name.trim(), description.trim());
    navigate(`/projects/${project.id}`);
  }

  function remove(p: Project) {
    const count = projectFlows(p.id).length;
    if (count > 0) {
      window.alert(`The project "${p.name}" has ${count} flow(s). Delete or move the flows first.`);
      return;
    }
    if (!window.confirm(`Delete the project "${p.name}"?`)) return;
    deleteProject(p.id);
    setProjects(listProjects());
  }

  return (
    <div className="min-h-dvh bg-background">
      <Header>
        <Button size="sm" onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden="true"/> New project</Button>
      </Header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
        <h1 className="text-2xl font-semibold">Projects</h1>

        {creating && (
          <form onSubmit={create} className="flex flex-col gap-3 rounded-xl border border-primary/60 bg-card p-5 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Name</span>
              <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="ERP integration" className={fieldInput}/>
            </label>
            <label className="flex flex-[2] flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Description</span>
              <input value={description} onChange={e => setDescription(e.target.value)} className={fieldInput}/>
            </label>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={!name.trim()}>Create</Button>
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => setCreating(false)} aria-label="Cancel"><X className="size-4"/></Button>
            </div>
          </form>
        )}

        <ul className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
          {projects.map(p => {
            const flows = projectFlows(p.id);
            return (
              <li key={p.id}>
                <article className="group flex h-full flex-col gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/60">
                  <div className="flex items-start gap-3">
                    <FolderKanban className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true"/>
                    <div className="min-w-0 flex-1">
                      <Link to={`/projects/${p.id}`} className="text-base font-semibold hover:underline">{p.name}</Link>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{p.description || 'No description.'}</p>
                    </div>
                  </div>
                  <ul className="flex flex-wrap gap-1.5">
                    {flows.slice(0, 4).map(f => (
                      <li key={f.id} className="max-w-full truncate rounded-md bg-muted px-2 py-0.5 text-sm text-muted-foreground">{f.name}</li>
                    ))}
                    {flows.length > 4 && <li className="px-1 text-sm text-muted-foreground">+{flows.length - 4}</li>}
                  </ul>
                  <div className="mt-auto flex items-center gap-3 border-t border-border pt-3 text-sm text-muted-foreground">
                    <span className={cn(flows.length === 0 && 'italic')}>{flows.length} flow(s)</span>
                    <span>{shortDate(p.updatedAt)}</span>
                    <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={() => remove(p)} aria-label="Delete project" title="Delete project">
                      <Trash2 className="size-4"/>
                    </Button>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
