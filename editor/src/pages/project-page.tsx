import {useCallback, useEffect, useRef, useState, type FormEvent, type InputHTMLAttributes} from 'react';
import {Link, useParams, useSearchParams} from 'react-router';
import {Download, Eye, EyeOff, KeyRound, Pencil, RefreshCw, Trash2, Upload} from 'lucide-react';
import type {RunRecord} from '@dataflow/core';
import {StatusIcon, ms, STATUS_LABEL} from '#run/run-panel';
import {getProject} from '#data/projects';
import {request} from '#data/api';
import {Button} from '#ui/button';
import {fieldInput} from '#ui/expression-field';
import {cn} from '#lib/utils';
import {FlowsTab} from '#pages/flows-tab';
import {Header, shortDate} from '#pages/header';

type Tab = 'flows' | 'runs' | 'secrets' | 'files';

const API = '/api';

const TABS: [Tab, string][] = [['flows', 'Flows'], ['runs', 'Runs'], ['secrets', 'Secrets'], ['files', 'Files']];

/** Project: Flows, Runs, Secrets and Files tabs (the tab lives in the URL, ?tab=). */
export function ProjectPage() {
  const {projectId = ''} = useParams();
  const [search, setSearch] = useSearchParams();
  const tab = (TABS.find(([value]) => value === search.get('tab'))?.[0] ?? 'flows') as Tab;
  const project = getProject(projectId);

  if (!project) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        Project not found.
        <Link to="/" className="text-primary hover:underline">Back to the projects</Link>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background">
      <Header breadcrumb={[{label: project.name}]}/>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
        <div>
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          {project.description && <p className="mt-1 text-sm text-muted-foreground">{project.description}</p>}
        </div>
        <div role="tablist" className="flex gap-1 border-b border-border">
          {TABS.map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setSearch(value === 'flows' ? {} : {tab: value})}
                    className={cn('-mb-px border-b-2 px-4 py-2 text-sm transition-colors',
                      tab === value ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
              {label}
            </button>
          ))}
        </div>
        <div role="tabpanel">
          {tab === 'flows' && <FlowsTab projectId={projectId}/>}
          {tab === 'runs' && <RunsTab projectId={projectId}/>}
          {tab === 'secrets' && <SecretsTab projectId={projectId}/>}
          {tab === 'files' && <FilesTab projectId={projectId}/>}
        </div>
      </main>
    </div>
  );
}

function ErrorMessage({message}: {message: string | null}) {
  return message ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{message}</p> : null;
}

function Empty({children}: {children: string}) {
  return <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{children}</p>;
}

// ---------- Runs: the runner's latest ones (in memory until there is a database) ----------

type RunSummary = Omit<RunRecord, 'components'> & {workflowId?: string};

function RunsTab({projectId}: {projectId: string}) {
  const [list, setList] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    request<RunSummary[]>(`/runs?project=${encodeURIComponent(projectId)}`).then(setList).catch(e => setError(e.message));
  }, [projectId]);
  useEffect(load, [load]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">The runner's latest 50, kept in memory (they go away when it restarts).</p>
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="size-4" aria-hidden="true"/> Refresh</Button>
      </div>
      <ErrorMessage message={error}/>
      {list && list.length === 0 && <Empty>No runs of this project since the runner started.</Empty>}
      {list && list.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-[20px_minmax(0,1fr)_160px_110px_90px_90px] gap-3 border-b border-border bg-muted/50 px-4 py-2 text-sm text-muted-foreground">
            <span/><span>Flow</span><span>Start</span><span>Status</span><span className="text-right">Duration</span><span className="text-right">Id</span>
          </div>
          <ul>
            {list.map(e => (
              <li key={e.run.id} className="border-b border-border last:border-b-0">
                <Link to={`/projects/${projectId}/runs/${e.run.id}`}
                      className="grid grid-cols-[20px_minmax(0,1fr)_160px_110px_90px_90px] items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent">
                  <StatusIcon status={e.status}/>
                  <span className="truncate font-medium">{e.run.workflow}{e.run.parentId && <span className="ml-2 text-muted-foreground">(called)</span>}</span>
                  <span className="text-muted-foreground">{shortDate(e.run.startedAt)}</span>
                  <span className={cn(e.status === 'failed' && 'text-destructive')}>{STATUS_LABEL[e.status]}</span>
                  <span className="text-right font-mono">{ms(e.durationMs)}</span>
                  <span className="text-right font-mono text-muted-foreground">{e.run.id.slice(0, 8)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------- Secrets: the list has only the names; a value comes from the runner only when shown ----------

type Secret = {name: string; source: 'project' | 'shared'};

function ShowToggle({shown, onToggle, label}: {shown: boolean; onToggle: () => void; label: string}) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" role="switch" aria-checked={shown} onClick={onToggle}
            aria-label={`${shown ? 'Mask' : 'Show'} ${label}`} title={shown ? 'Mask' : 'Show'}>
      {shown ? <EyeOff className="size-4"/> : <Eye className="size-4"/>}
    </Button>
  );
}

/** value field masked by default, with a switch to show what was typed */
function SecretInput({value, onChange, label, ...rest}: {value: string; onChange: (value: string) => void; label: string} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [shown, setShown] = useState(false);
  return (
    <div className="flex flex-1 items-center gap-1">
      <input {...rest} type={shown ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)} autoComplete="new-password" spellCheck={false}
             aria-label={label} className={cn(fieldInput, 'min-w-0 flex-1 font-mono')}/>
      <ShowToggle shown={shown} onToggle={() => setShown(!shown)} label={label}/>
    </div>
  );
}

function SecretsTab({projectId}: {projectId: string}) {
  const [list, setList] = useState<Secret[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [newValue, setNewValue] = useState('');
  /** values the user chose to show, by name (masked again on a reload) */
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const base = `/projects/${encodeURIComponent(projectId)}/secrets`;
  const load = useCallback(() => {
    setRevealed({});
    request<Secret[]>(base).then(setList).catch(e => setError(e.message));
  }, [base]);

  async function toggleShown(s: Secret) {
    if (s.name in revealed) {
      setRevealed(r => Object.fromEntries(Object.entries(r).filter(([name]) => name !== s.name)));
      return;
    }
    setError(null);
    try {
      const {value} = await request<{value: string}>(`${base}/${encodeURIComponent(s.name)}`);
      setRevealed(r => ({...r, [s.name]: value}));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(load, [load]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await request(`${base}/${encodeURIComponent(name.trim())}`, {method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify({value})});
      setName('');
      setValue('');
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  /** a new value for an existing secret; on a shared one it becomes this project's own */
  async function replace(e: FormEvent) {
    e.preventDefault();
    if (!editing || !newValue) return;
    setError(null);
    try {
      await request(`${base}/${encodeURIComponent(editing)}`, {method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify({value: newValue})});
      setEditing(null);
      setNewValue('');
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function startEditing(s: Secret) {
    setEditing(s.name);
    setNewValue('');
  }

  async function remove(s: Secret) {
    if (!window.confirm(`Delete the secret ${s.name}?`)) return;
    try {
      await request(`${base}/${encodeURIComponent(s.name)}`, {method: 'DELETE'});
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={save} className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-sm text-muted-foreground">Name</span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="MY_SQL_DATABASE" spellCheck={false} className={cn(fieldInput, 'font-mono')}/>
        </label>
        <div className="flex flex-[2] flex-col gap-1">
          <span className="text-sm text-muted-foreground" aria-hidden="true">Value</span>
          <SecretInput value={value} onChange={setValue} label="Value"/>
        </div>
        <Button type="submit" size="sm" disabled={!name.trim() || !value}>Save</Button>
      </form>
      <ErrorMessage message={error}/>
      {list && list.length === 0 && <Empty>No secrets. Components use them as $SECRETS.NAME.</Empty>}
      {list && list.length > 0 && (
        <ul className="overflow-hidden rounded-lg border border-border">
          {list.map(s => (
            <li key={s.name} className="flex items-center gap-3 border-b border-border px-4 py-2.5 text-sm last:border-b-0">
              <KeyRound className="size-4 text-muted-foreground" aria-hidden="true"/>
              <span className="font-mono">{s.name}</span>
              {editing === s.name ? (
                <form onSubmit={replace} className="flex flex-1 items-center gap-2">
                  <SecretInput value={newValue} onChange={setNewValue} label={`New value of ${s.name}`} placeholder="New value" autoFocus
                               onKeyDown={e => e.key === 'Escape' && setEditing(null)}/>
                  <Button type="submit" size="sm" disabled={!newValue}>Save</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                </form>
              ) : (
                <>
                  {s.name in revealed
                    ? <span className="min-w-0 truncate select-all font-mono" title={revealed[s.name]}>{revealed[s.name]}</span>
                    : <span className="font-mono text-muted-foreground">••••••••</span>}
                  <ShowToggle shown={s.name in revealed} onToggle={() => toggleShown(s)} label={s.name}/>
                  <span className={cn('rounded-full px-2 py-0.5 text-sm', s.source === 'project' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground')}
                        title={s.source === 'shared' ? 'Applies to every project (top level of secrets.local.json)' : undefined}>
                    {s.source === 'project' ? 'this project' : 'shared'}
                  </span>
                  <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={() => startEditing(s)} aria-label={`Change the value of ${s.name}`}
                          title={s.source === 'shared' ? 'Set a value for this project' : 'Change value'}><Pencil className="size-4"/></Button>
                  {s.source === 'project' && (
                    <Button variant="ghost" size="icon-sm" onClick={() => remove(s)} aria-label={`Delete ${s.name}`} title="Delete"><Trash2 className="size-4"/></Button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- Files: stored in the runner, per project ----------

type StoredFile = {name: string; size: number; updatedAt: string};

const fileSize = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`);

function FilesTab({projectId}: {projectId: string}) {
  const [list, setList] = useState<StoredFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const base = `/projects/${encodeURIComponent(projectId)}/files`;
  const load = useCallback(() => {
    request<StoredFile[]>(base).then(setList).catch(e => setError(e.message));
  }, [base]);
  useEffect(load, [load]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setUploading(true);
    try {
      for (const file of files) {
        const body = new FormData();
        body.append('file', file);
        await request(base, {method: 'POST', body});
      }
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  }

  async function remove(a: StoredFile) {
    if (!window.confirm(`Delete ${a.name}?`)) return;
    await request(`${base}/${encodeURIComponent(a.name)}`, {method: 'DELETE'}).catch(e => setError(e.message));
    load();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <input ref={input} type="file" multiple className="hidden" onChange={e => upload(e.target.files)}/>
        <Button size="sm" onClick={() => input.current?.click()} disabled={uploading}>
          <Upload className="size-4" aria-hidden="true"/> {uploading ? 'Uploading…' : 'Upload files'}
        </Button>
      </div>
      <ErrorMessage message={error}/>
      {list && list.length === 0 && <Empty>No files. The CSVs the flows read live here.</Empty>}
      {list && list.length > 0 && (
        <ul className="overflow-hidden rounded-lg border border-border">
          {list.map(a => (
            <li key={a.name} className="flex items-center gap-3 border-b border-border px-4 py-2.5 text-sm last:border-b-0">
              <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
              <span className="font-mono text-muted-foreground">{fileSize(a.size)}</span>
              <span className="text-muted-foreground">{shortDate(a.updatedAt)}</span>
              <a href={`${API}${base}/${encodeURIComponent(a.name)}`} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={`Download ${a.name}`} title="Download">
                <Download className="size-4"/>
              </a>
              <Button variant="ghost" size="icon-sm" onClick={() => remove(a)} aria-label={`Delete ${a.name}`} title="Delete"><Trash2 className="size-4"/></Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
