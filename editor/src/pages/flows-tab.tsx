import {useState, type FormEvent, type ReactNode} from 'react'
import {Link, useNavigate, useSearchParams} from 'react-router'
import {ChevronDown, ChevronRight, Copy, Folder, FolderOpen, FolderPlus, LayoutGrid, ListTree, Pencil, Plus, Trash2, Workflow, X} from 'lucide-react'
import {CATEGORIES, isFlowNode, BY_TYPE} from '@/components/catalog'
import {isComponent} from '@/editor/validation'
import {isInside, duplicateFlow, deleteFlow, projectFlows, moveFlow, renameFlowsFolder, type Flow} from '@/mock/flows'
import {createFolder, getProject, replaceFolders} from '@/mock/projects'
import {Button} from '@/ui/button'
import {fieldInput} from '@/ui/expression-field'
import {cn} from '@/lib/utils'
import {shortDate} from './header'

function entitiesOf(flow: Flow) {
  const names = flow.nodes
    .filter(isComponent)
    .filter(n => BY_TYPE[n.data.type]?.category === 'entity')
    .map(n => BY_TYPE[n.data.type].label.replace('Create ', ''))
  return [...new Set(names)]
}

function componentsOf(flow: Flow) {
  return flow.nodes.filter(n => isComponent(n) && !isFlowNode(n.data.type)).length
}

const join = (folder: string, name: string) => (folder ? `${folder}/${name}` : name)
const nameOf = (folder: string) => folder.split('/').pop() ?? folder
const parentOf = (folder: string) => folder.split('/').slice(0, -1).join('/')

/** Every folder of the project: the stored ones, the ones with a flow and the ones above them. */
function foldersOf(projectId: string, flows: Flow[]) {
  const paths = new Set<string>()
  for (const c of [...(getProject(projectId)?.folders ?? []), ...flows.map(f => f.folder ?? '')]) {
    const parts = c.split('/').filter(Boolean)
    parts.forEach((_, i) => paths.add(parts.slice(0, i + 1).join('/')))
  }
  return [...paths].sort((a, b) => a.localeCompare(b))
}

type View = 'cards' | 'tree'
const VIEW_KEY = 'dataflow-flows-view'

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'tree' ? 'tree' : 'cards'
  } catch {
    return 'cards'
  }
}

const invalidName = (name: string) => !name.trim() ? 'Enter a name.' : name.includes('/') ? 'The name cannot contain "/".' : null

/** The project's Flows tab, browsing by folders (the open folder lives in the URL, ?folder=). */
export function FlowsTab({projectId}: {projectId: string}) {
  const navigate = useNavigate()
  const [search, setSearch] = useSearchParams()
  const current = search.get('folder') ?? ''
  const [flows, setFlows] = useState(() => projectFlows(projectId))
  const [version, setVersion] = useState(0)
  const reload = () => {
    setFlows(projectFlows(projectId))
    setVersion(v => v + 1)
  }
  const [view, setView] = useState(readView)
  const changeView = (v: View) => {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // no storage: only lasts until reload
    }
  }
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [folderName, setFolderName] = useState('')
  const pathOf = (id: string) => `/projects/${projectId}/flows/${id}`
  const open = (folder: string) => setSearch(folder ? {folder} : {})

  void version // the stored folders come from the project (mock): reload reads them again
  const folders = foldersOf(projectId, flows)
  const subfolders = folders.filter(p => parentOf(p) === current && p !== current)
  const here = flows.filter(f => (f.folder ?? '') === current)
  const countIn = (folder: string) => flows.filter(f => isInside(f.folder ?? '', folder)).length

  function newFolder(e: FormEvent) {
    e.preventDefault()
    const issue = invalidName(folderName)
    if (issue) return window.alert(issue)
    createFolder(projectId, join(current, folderName.trim()))
    setFolderName('')
    setCreatingFolder(false)
    reload()
  }

  function rename(folder: string) {
    const name = window.prompt('New folder name', nameOf(folder))
    if (name === null || name.trim() === nameOf(folder)) return
    const issue = invalidName(name)
    if (issue) return window.alert(issue)
    const renamed = join(parentOf(folder), name.trim())
    if (folders.includes(renamed)) return window.alert('A folder with that name already exists here.')
    renameFlowsFolder(projectId, folder, renamed)
    replaceFolders(projectId, folder, renamed)
    reload()
  }

  function removeFolder(folder: string) {
    const count = countIn(folder)
    if (count > 0) return window.alert(`The folder "${nameOf(folder)}" has ${count} flow(s). Move or delete the flows first.`)
    if (!window.confirm(`Delete the folder "${nameOf(folder)}"?`)) return
    replaceFolders(projectId, folder, '')
    reload()
  }

  function remove(f: Flow) {
    if (!window.confirm(`Delete the flow "${f.name}"?`)) return
    deleteFlow(f.id)
    reload()
  }

  const entityColor = CATEGORIES.entity
  const breadcrumb = current ? current.split('/') : []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Folder" className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
          <button type="button" onClick={() => open('')} className={cn('rounded px-1.5 py-0.5 hover:bg-accent', !current ? 'font-medium' : 'text-muted-foreground')}>Flows</button>
          {breadcrumb.map((name, i) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true"/>
              <button type="button" onClick={() => open(breadcrumb.slice(0, i + 1).join('/'))}
                      className={cn('rounded px-1.5 py-0.5 hover:bg-accent', i === breadcrumb.length - 1 ? 'font-medium' : 'text-muted-foreground')}>
                {name}
              </button>
            </span>
          ))}
        </nav>
        <div className="ml-auto flex gap-2">
          <div role="radiogroup" aria-label="View" className="flex rounded-md border border-border p-0.5">
            {([['cards', LayoutGrid, 'Cards'], ['tree', ListTree, 'Tree']] as const).map(([value, Icon, label]) => (
              <button key={value} type="button" role="radio" aria-checked={view === value} onClick={() => changeView(value)}
                      className={cn('flex h-7 items-center gap-1.5 rounded px-2 text-sm', view === value ? 'bg-accent font-medium' : 'text-muted-foreground hover:text-foreground')}>
                <Icon className="size-4" aria-hidden="true"/> {label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => setCreatingFolder(true)}><FolderPlus className="size-4" aria-hidden="true"/> New folder</Button>
          <Button size="sm" onClick={() => navigate(`${pathOf('new')}${current ? `?folder=${encodeURIComponent(current)}` : ''}`)}>
            <Plus className="size-4" aria-hidden="true"/> New flow
          </Button>
        </div>
      </div>

      {creatingFolder && (
        <form onSubmit={newFolder} className="flex items-center gap-2 rounded-lg border border-primary/60 p-3">
          <Folder className="size-4 text-muted-foreground" aria-hidden="true"/>
          <input autoFocus value={folderName} onChange={e => setFolderName(e.target.value)} placeholder="Folder name" aria-label="Folder name" className={cn(fieldInput, 'max-w-xs')}/>
          <Button type="submit" size="sm" disabled={!folderName.trim()}>Create</Button>
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => setCreatingFolder(false)} aria-label="Cancel"><X className="size-4"/></Button>
        </form>
      )}

      {view === 'tree' && (
        <Tree folders={folders} flows={flows} current={current} pathOf={pathOf} onOpen={folder => {
          changeView('cards')
          open(folder)
        }} onRename={rename} onRemoveFolder={removeFolder} onRemove={remove}/>
      )}

      {view === 'cards' && subfolders.length > 0 && (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {subfolders.map(p => (
            <li key={p}>
              <div className="group flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-primary/60">
                <button type="button" onClick={() => open(p)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <Folder className="size-5 shrink-0 text-primary" aria-hidden="true"/>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{nameOf(p)}</span>
                    <span className="block text-sm text-muted-foreground">{countIn(p)} flow(s)</span>
                  </span>
                </button>
                <Button variant="ghost" size="icon-sm" onClick={() => rename(p)} aria-label={`Rename ${nameOf(p)}`} title="Rename"><Pencil className="size-4"/></Button>
                <Button variant="ghost" size="icon-sm" onClick={() => removeFolder(p)} aria-label={`Delete ${nameOf(p)}`} title="Delete"><Trash2 className="size-4"/></Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {view === 'cards' && <ul className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-4">
        {here.map(f => (
          <li key={f.id}>
            <article className="group flex h-full flex-col gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/60">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <Link to={pathOf(f.id)} className="text-base font-semibold hover:underline">{f.name}</Link>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{f.description || 'No description.'}</p>
                </div>
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-sm font-medium',
                  f.status === 'published' ? 'bg-entity/15 text-entity' : 'bg-muted text-muted-foreground')}>
                  {f.status === 'published' ? 'Published' : 'Draft'}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {entitiesOf(f).map(e => (
                  <span key={e} className={cn('rounded-md px-2 py-0.5 text-sm', entityColor.bgColor, entityColor.textColor)}>{e}</span>
                ))}
                {entitiesOf(f).length === 0 && <span className="text-sm text-muted-foreground">No target yet</span>}
              </div>
              <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3 text-sm text-muted-foreground">
                <div className="flex min-w-0 items-center gap-3 whitespace-nowrap">
                  <span className="font-mono">v{f.version}</span>
                  <span>{componentsOf(f)} components</span>
                  <span className="ml-auto truncate">{shortDate(f.updatedAt)}</span>
                </div>
                <div className="flex min-w-0 items-center gap-1">
                  <select value={f.folder ?? ''} aria-label={`Move ${f.name} to the folder`} title="Move to the folder"
                          onChange={e => {
                            moveFlow(f.id, e.target.value)
                            reload()
                          }}
                          className="mr-auto h-8 min-w-0 max-w-full truncate rounded-md border border-transparent bg-transparent px-1 text-sm text-muted-foreground hover:border-border">
                    <option value="">Flows (root)</option>
                    {folders.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <Button variant="ghost" size="icon-sm" onClick={() => navigate(pathOf(f.id))} aria-label="Edit" title="Edit"><Pencil className="size-4"/></Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => {
                    duplicateFlow(f.id)
                    reload()
                  }} aria-label="Duplicate" title="Duplicate"><Copy className="size-4"/></Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => remove(f)} aria-label="Delete" title="Delete"><Trash2 className="size-4"/></Button>
                </div>
              </div>
            </article>
          </li>
        ))}
      </ul>}
      {view === 'cards' && here.length === 0 && subfolders.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {current ? 'Empty folder.' : 'No flows yet. Create a new one to start.'}
        </p>
      )}
    </div>
  )
}

/**
 * Tree view: the whole project, with the folders open or closed and the flows as leaves. It starts with
 * everything open; clicking a folder opens or closes it.
 */
function Tree({folders, flows, current, pathOf, onOpen, onRename, onRemoveFolder, onRemove}: {
  folders: string[]
  flows: Flow[]
  current: string
  pathOf: (id: string) => string
  onOpen: (folder: string) => void
  onRename: (folder: string) => void
  onRemoveFolder: (folder: string) => void
  onRemove: (flow: Flow) => void
}) {
  const navigate = useNavigate()
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const toggle = (folder: string) => setClosed(before => {
    const next = new Set(before)
    if (next.has(folder)) next.delete(folder)
    else next.add(folder)
    return next
  })
  const indent = (level: number) => ({paddingLeft: `${12 + level * 20}px`})
  const actions = 'flex opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100'

  function level(folder: string, depth: number): ReactNode {
    const children = folders.filter(p => parentOf(p) === folder && p !== folder)
    const leaves = flows.filter(f => (f.folder ?? '') === folder).sort((a, b) => a.name.localeCompare(b.name))
    return (
      <>
        {children.map(p => {
          const isOpen = !closed.has(p)
          return (
            <li key={p}>
              <div className={cn('group flex items-center gap-2 border-b border-border py-1.5 pr-2 text-sm hover:bg-accent', p === current && 'bg-primary/5')} style={indent(depth)}>
                <button type="button" onClick={() => toggle(p)} aria-expanded={isOpen} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  {isOpen ? <ChevronDown className="size-4 text-muted-foreground"/> : <ChevronRight className="size-4 text-muted-foreground"/>}
                  {isOpen ? <FolderOpen className="size-4 shrink-0 text-primary" aria-hidden="true"/> : <Folder className="size-4 shrink-0 text-primary" aria-hidden="true"/>}
                  <span className="truncate font-medium">{nameOf(p)}</span>
                  <span className="text-muted-foreground">{flows.filter(f => isInside(f.folder ?? '', p)).length}</span>
                </button>
                <div className={actions}>
                  <Button variant="ghost" size="icon-sm" onClick={() => onOpen(p)} aria-label={`Open ${nameOf(p)} in the cards`} title="Open the folder in the cards"><LayoutGrid className="size-4"/></Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => onRename(p)} aria-label={`Rename ${nameOf(p)}`} title="Rename"><Pencil className="size-4"/></Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => onRemoveFolder(p)} aria-label={`Delete ${nameOf(p)}`} title="Delete"><Trash2 className="size-4"/></Button>
                </div>
              </div>
              {isOpen && <ul>{level(p, depth + 1)}</ul>}
            </li>
          )
        })}
        {leaves.map(f => (
          <li key={f.id}>
            <div className="group flex items-center gap-2 border-b border-border py-1.5 pr-2 text-sm hover:bg-accent" style={indent(depth)}>
              <span className="size-4 shrink-0"/>
              <Workflow className="size-4 shrink-0 text-muted-foreground" aria-hidden="true"/>
              <Link to={pathOf(f.id)} className="min-w-0 flex-1 truncate hover:underline" title={f.description || undefined}>{f.name}</Link>
              <span className={cn('rounded-full px-2 py-0.5 text-sm', f.status === 'published' ? 'bg-entity/15 text-entity' : 'bg-muted text-muted-foreground')}>
                {f.status === 'published' ? 'Published' : 'Draft'}
              </span>
              <span className="hidden w-10 text-right font-mono text-muted-foreground sm:inline">v{f.version}</span>
              <span className="hidden w-32 text-right text-muted-foreground md:inline">{shortDate(f.updatedAt)}</span>
              <div className={actions}>
                <Button variant="ghost" size="icon-sm" onClick={() => navigate(pathOf(f.id))} aria-label={`Edit ${f.name}`} title="Edit"><Pencil className="size-4"/></Button>
                <Button variant="ghost" size="icon-sm" onClick={() => onRemove(f)} aria-label={`Delete ${f.name}`} title="Delete"><Trash2 className="size-4"/></Button>
              </div>
            </div>
          </li>
        ))}
      </>
    )
  }

  if (flows.length === 0 && folders.length === 0) {
    return <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No flows yet. Create a new one to start.</p>
  }
  return <ul className="overflow-hidden rounded-lg border border-border">{level('', 0)}</ul>
}
