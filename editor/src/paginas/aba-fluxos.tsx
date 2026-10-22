import {useState, type FormEvent, type ReactNode} from 'react'
import {Link, useNavigate, useSearchParams} from 'react-router'
import {ChevronDown, ChevronRight, Copy, Folder, FolderOpen, FolderPlus, LayoutGrid, ListTree, Pencil, Plus, Trash2, Workflow, X} from 'lucide-react'
import {CATEGORIAS, ehDoFluxo, POR_TIPO} from '@/componentes/catalogo'
import {ehComponente} from '@/editor/validacao'
import {dentroDe, duplicarFluxo, excluirFluxo, fluxosDoProjeto, moverFluxo, renomearPastaDosFluxos, type Fluxo} from '@/mock/fluxos'
import {criarPasta, obterProjeto, trocarPastas} from '@/mock/projetos'
import {Button} from '@/ui/button'
import {inputCampo} from '@/ui/campo-expression'
import {cn} from '@/lib/utils'
import {dataCurta} from './cabecalho'

function entidadesDo(fluxo: Fluxo) {
  const nomes = fluxo.nodes
    .filter(ehComponente)
    .filter(n => POR_TIPO[n.data.tipo]?.categoria === 'entidade')
    .map(n => POR_TIPO[n.data.tipo].rotulo.replace('Criar ', ''))
  return [...new Set(nomes)]
}

function componentesDo(fluxo: Fluxo) {
  return fluxo.nodes.filter(n => ehComponente(n) && !ehDoFluxo(n.data.tipo)).length
}

const juntar = (pasta: string, nome: string) => (pasta ? `${pasta}/${nome}` : nome)
const nomeDa = (pasta: string) => pasta.split('/').pop() ?? pasta
const pai = (pasta: string) => pasta.split('/').slice(0, -1).join('/')

/** Todas as pastas do projeto: as guardadas, as que têm fluxo e as de cima delas. */
function pastasDo(projetoId: string, fluxos: Fluxo[]) {
  const caminhos = new Set<string>()
  for (const c of [...(obterProjeto(projetoId)?.pastas ?? []), ...fluxos.map(f => f.pasta ?? '')]) {
    const partes = c.split('/').filter(Boolean)
    partes.forEach((_, i) => caminhos.add(partes.slice(0, i + 1).join('/')))
  }
  return [...caminhos].sort((a, b) => a.localeCompare(b))
}

type Visualizacao = 'cards' | 'arvore'
const CHAVE_DA_VISUALIZACAO = 'dataflow-fluxos-visualizacao'

function lerVisualizacao(): Visualizacao {
  try {
    return localStorage.getItem(CHAVE_DA_VISUALIZACAO) === 'arvore' ? 'arvore' : 'cards'
  } catch {
    return 'cards'
  }
}

const nomeInvalido = (nome: string) => !nome.trim() ? 'Dê um nome.' : nome.includes('/') ? 'O nome não pode ter "/".' : null

/** Aba Fluxos do projeto, navegando por pastas (a pasta aberta fica na URL, ?pasta=). */
export function AbaFluxos({projetoId}: {projetoId: string}) {
  const navegar = useNavigate()
  const [busca, setBusca] = useSearchParams()
  const atual = busca.get('pasta') ?? ''
  const [fluxos, setFluxos] = useState(() => fluxosDoProjeto(projetoId))
  const [versao, setVersao] = useState(0)
  const recarregar = () => {
    setFluxos(fluxosDoProjeto(projetoId))
    setVersao(v => v + 1)
  }
  const [visualizacao, setVisualizacao] = useState(lerVisualizacao)
  const trocarVisualizacao = (v: Visualizacao) => {
    setVisualizacao(v)
    try {
      localStorage.setItem(CHAVE_DA_VISUALIZACAO, v)
    } catch {
      // sem storage: vale só até recarregar
    }
  }
  const [criandoPasta, setCriandoPasta] = useState(false)
  const [nomeDaPasta, setNomeDaPasta] = useState('')
  const caminho = (id: string) => `/projetos/${projetoId}/fluxos/${id}`
  const abrir = (pasta: string) => setBusca(pasta ? {pasta} : {})

  void versao // as pastas guardadas vêm do projeto (mock): recarregar relê
  const pastas = pastasDo(projetoId, fluxos)
  const subpastas = pastas.filter(p => pai(p) === atual && p !== atual)
  const aqui = fluxos.filter(f => (f.pasta ?? '') === atual)
  const quantosEm = (pasta: string) => fluxos.filter(f => dentroDe(f.pasta ?? '', pasta)).length

  function novaPasta(e: FormEvent) {
    e.preventDefault()
    const problema = nomeInvalido(nomeDaPasta)
    if (problema) return window.alert(problema)
    criarPasta(projetoId, juntar(atual, nomeDaPasta.trim()))
    setNomeDaPasta('')
    setCriandoPasta(false)
    recarregar()
  }

  function renomear(pasta: string) {
    const nome = window.prompt('Novo nome da pasta', nomeDa(pasta))
    if (nome === null || nome.trim() === nomeDa(pasta)) return
    const problema = nomeInvalido(nome)
    if (problema) return window.alert(problema)
    const nova = juntar(pai(pasta), nome.trim())
    if (pastas.includes(nova)) return window.alert('Já existe uma pasta com esse nome aqui.')
    renomearPastaDosFluxos(projetoId, pasta, nova)
    trocarPastas(projetoId, pasta, nova)
    recarregar()
  }

  function apagar(pasta: string) {
    const qtd = quantosEm(pasta)
    if (qtd > 0) return window.alert(`A pasta "${nomeDa(pasta)}" tem ${qtd} fluxo(s). Mova ou exclua os fluxos antes.`)
    if (!window.confirm(`Apagar a pasta "${nomeDa(pasta)}"?`)) return
    trocarPastas(projetoId, pasta, '')
    recarregar()
  }

  function excluir(f: Fluxo) {
    if (!window.confirm(`Excluir o fluxo "${f.nome}"?`)) return
    excluirFluxo(f.id)
    recarregar()
  }

  const corEntidade = CATEGORIAS.entidade
  const trilha = atual ? atual.split('/') : []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Pasta" className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
          <button type="button" onClick={() => abrir('')} className={cn('rounded px-1.5 py-0.5 hover:bg-accent', !atual ? 'font-medium' : 'text-muted-foreground')}>Fluxos</button>
          {trilha.map((nome, i) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true"/>
              <button type="button" onClick={() => abrir(trilha.slice(0, i + 1).join('/'))}
                      className={cn('rounded px-1.5 py-0.5 hover:bg-accent', i === trilha.length - 1 ? 'font-medium' : 'text-muted-foreground')}>
                {nome}
              </button>
            </span>
          ))}
        </nav>
        <div className="ml-auto flex gap-2">
          <div role="radiogroup" aria-label="Visualização" className="flex rounded-md border border-border p-0.5">
            {([['cards', LayoutGrid, 'Cards'], ['arvore', ListTree, 'Árvore']] as const).map(([valor, Icone, rotulo]) => (
              <button key={valor} type="button" role="radio" aria-checked={visualizacao === valor} onClick={() => trocarVisualizacao(valor)}
                      className={cn('flex h-7 items-center gap-1.5 rounded px-2 text-sm', visualizacao === valor ? 'bg-accent font-medium' : 'text-muted-foreground hover:text-foreground')}>
                <Icone className="size-4" aria-hidden="true"/> {rotulo}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => setCriandoPasta(true)}><FolderPlus className="size-4" aria-hidden="true"/> Nova pasta</Button>
          <Button size="sm" onClick={() => navegar(`${caminho('novo')}${atual ? `?pasta=${encodeURIComponent(atual)}` : ''}`)}>
            <Plus className="size-4" aria-hidden="true"/> Novo fluxo
          </Button>
        </div>
      </div>

      {criandoPasta && (
        <form onSubmit={novaPasta} className="flex items-center gap-2 rounded-lg border border-primary/60 p-3">
          <Folder className="size-4 text-muted-foreground" aria-hidden="true"/>
          <input autoFocus value={nomeDaPasta} onChange={e => setNomeDaPasta(e.target.value)} placeholder="Nome da pasta" aria-label="Nome da pasta" className={cn(inputCampo, 'max-w-xs')}/>
          <Button type="submit" size="sm" disabled={!nomeDaPasta.trim()}>Criar</Button>
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => setCriandoPasta(false)} aria-label="Cancelar"><X className="size-4"/></Button>
        </form>
      )}

      {visualizacao === 'arvore' && (
        <Arvore pastas={pastas} fluxos={fluxos} atual={atual} caminho={caminho} onAbrir={pasta => {
          trocarVisualizacao('cards')
          abrir(pasta)
        }} onRenomear={renomear} onApagar={apagar} onExcluir={excluir}/>
      )}

      {visualizacao === 'cards' && subpastas.length > 0 && (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {subpastas.map(p => (
            <li key={p}>
              <div className="group flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-primary/60">
                <button type="button" onClick={() => abrir(p)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <Folder className="size-5 shrink-0 text-primary" aria-hidden="true"/>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{nomeDa(p)}</span>
                    <span className="block text-sm text-muted-foreground">{quantosEm(p)} fluxo(s)</span>
                  </span>
                </button>
                <Button variant="ghost" size="icon-sm" onClick={() => renomear(p)} aria-label={`Renomear ${nomeDa(p)}`} title="Renomear"><Pencil className="size-4"/></Button>
                <Button variant="ghost" size="icon-sm" onClick={() => apagar(p)} aria-label={`Apagar ${nomeDa(p)}`} title="Apagar"><Trash2 className="size-4"/></Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {visualizacao === 'cards' && <ul className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-4">
        {aqui.map(f => (
          <li key={f.id}>
            <article className="group flex h-full flex-col gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/60">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <Link to={caminho(f.id)} className="text-base font-semibold hover:underline">{f.nome}</Link>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{f.descricao || 'Sem descrição.'}</p>
                </div>
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-sm font-medium',
                  f.status === 'publicado' ? 'bg-entity/15 text-entity' : 'bg-muted text-muted-foreground')}>
                  {f.status === 'publicado' ? 'Publicado' : 'Rascunho'}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {entidadesDo(f).map(e => (
                  <span key={e} className={cn('rounded-md px-2 py-0.5 text-sm', corEntidade.corFundo, corEntidade.corTexto)}>{e}</span>
                ))}
                {entidadesDo(f).length === 0 && <span className="text-sm text-muted-foreground">Nenhum destino ainda</span>}
              </div>
              <div className="mt-auto flex items-center gap-3 border-t border-border pt-3 text-sm text-muted-foreground">
                <span className="font-mono">v{f.versao}</span>
                <span>{componentesDo(f)} componentes</span>
                <span>{dataCurta(f.atualizadoEm)}</span>
                <div className="ml-auto flex items-center gap-1">
                  <select value={f.pasta ?? ''} aria-label={`Mover ${f.nome} para a pasta`} title="Mover para a pasta"
                          onChange={e => {
                            moverFluxo(f.id, e.target.value)
                            recarregar()
                          }}
                          className="h-8 max-w-32 rounded-md border border-transparent bg-transparent px-1 text-sm text-muted-foreground hover:border-border">
                    <option value="">Fluxos (raiz)</option>
                    {pastas.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <Button variant="ghost" size="icon-sm" onClick={() => navegar(caminho(f.id))} aria-label="Editar" title="Editar"><Pencil className="size-4"/></Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => {
                    duplicarFluxo(f.id)
                    recarregar()
                  }} aria-label="Duplicar" title="Duplicar"><Copy className="size-4"/></Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => excluir(f)} aria-label="Excluir" title="Excluir"><Trash2 className="size-4"/></Button>
                </div>
              </div>
            </article>
          </li>
        ))}
      </ul>}
      {visualizacao === 'cards' && aqui.length === 0 && subpastas.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {atual ? 'Pasta vazia.' : 'Nenhum fluxo ainda. Crie um novo para começar.'}
        </p>
      )}
    </div>
  )
}

/**
 * Visualização em árvore: o projeto inteiro, com as pastas abertas ou fechadas e os fluxos como folhas. Começa com
 * tudo aberto; clicar na pasta abre ou fecha.
 */
function Arvore({pastas, fluxos, atual, caminho, onAbrir, onRenomear, onApagar, onExcluir}: {
  pastas: string[]
  fluxos: Fluxo[]
  atual: string
  caminho: (id: string) => string
  onAbrir: (pasta: string) => void
  onRenomear: (pasta: string) => void
  onApagar: (pasta: string) => void
  onExcluir: (fluxo: Fluxo) => void
}) {
  const navegar = useNavigate()
  const [fechadas, setFechadas] = useState<Set<string>>(new Set())
  const alternar = (pasta: string) => setFechadas(antes => {
    const proximo = new Set(antes)
    if (proximo.has(pasta)) proximo.delete(pasta)
    else proximo.add(pasta)
    return proximo
  })
  const recuo = (nivel: number) => ({paddingLeft: `${12 + nivel * 20}px`})
  const acoes = 'flex opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100'

  function nivel(pasta: string, profundidade: number): ReactNode {
    const filhas = pastas.filter(p => pai(p) === pasta && p !== pasta)
    const folhas = fluxos.filter(f => (f.pasta ?? '') === pasta).sort((a, b) => a.nome.localeCompare(b.nome))
    return (
      <>
        {filhas.map(p => {
          const aberta = !fechadas.has(p)
          return (
            <li key={p}>
              <div className={cn('group flex items-center gap-2 border-b border-border py-1.5 pr-2 text-sm hover:bg-accent', p === atual && 'bg-primary/5')} style={recuo(profundidade)}>
                <button type="button" onClick={() => alternar(p)} aria-expanded={aberta} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  {aberta ? <ChevronDown className="size-4 text-muted-foreground"/> : <ChevronRight className="size-4 text-muted-foreground"/>}
                  {aberta ? <FolderOpen className="size-4 shrink-0 text-primary" aria-hidden="true"/> : <Folder className="size-4 shrink-0 text-primary" aria-hidden="true"/>}
                  <span className="truncate font-medium">{nomeDa(p)}</span>
                  <span className="text-muted-foreground">{fluxos.filter(f => dentroDe(f.pasta ?? '', p)).length}</span>
                </button>
                <div className={acoes}>
                  <Button variant="ghost" size="icon-sm" onClick={() => onAbrir(p)} aria-label={`Abrir ${nomeDa(p)} nos cards`} title="Abrir a pasta nos cards"><LayoutGrid className="size-4"/></Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => onRenomear(p)} aria-label={`Renomear ${nomeDa(p)}`} title="Renomear"><Pencil className="size-4"/></Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => onApagar(p)} aria-label={`Apagar ${nomeDa(p)}`} title="Apagar"><Trash2 className="size-4"/></Button>
                </div>
              </div>
              {aberta && <ul>{nivel(p, profundidade + 1)}</ul>}
            </li>
          )
        })}
        {folhas.map(f => (
          <li key={f.id}>
            <div className="group flex items-center gap-2 border-b border-border py-1.5 pr-2 text-sm hover:bg-accent" style={recuo(profundidade)}>
              <span className="size-4 shrink-0"/>
              <Workflow className="size-4 shrink-0 text-muted-foreground" aria-hidden="true"/>
              <Link to={caminho(f.id)} className="min-w-0 flex-1 truncate hover:underline" title={f.descricao || undefined}>{f.nome}</Link>
              <span className={cn('rounded-full px-2 py-0.5 text-sm', f.status === 'publicado' ? 'bg-entity/15 text-entity' : 'bg-muted text-muted-foreground')}>
                {f.status === 'publicado' ? 'Publicado' : 'Rascunho'}
              </span>
              <span className="hidden w-10 text-right font-mono text-muted-foreground sm:inline">v{f.versao}</span>
              <span className="hidden w-32 text-right text-muted-foreground md:inline">{dataCurta(f.atualizadoEm)}</span>
              <div className={acoes}>
                <Button variant="ghost" size="icon-sm" onClick={() => navegar(caminho(f.id))} aria-label={`Editar ${f.nome}`} title="Editar"><Pencil className="size-4"/></Button>
                <Button variant="ghost" size="icon-sm" onClick={() => onExcluir(f)} aria-label={`Excluir ${f.nome}`} title="Excluir"><Trash2 className="size-4"/></Button>
              </div>
            </div>
          </li>
        ))}
      </>
    )
  }

  if (fluxos.length === 0 && pastas.length === 0) {
    return <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nenhum fluxo ainda. Crie um novo para começar.</p>
  }
  return <ul className="overflow-hidden rounded-lg border border-border">{nivel('', 0)}</ul>
}
