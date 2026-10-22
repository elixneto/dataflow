import {useState, type FormEvent} from 'react'
import {Link, useNavigate} from 'react-router'
import {FolderKanban, Plus, Trash2, X} from 'lucide-react'
import {fluxosDoProjeto} from '@/mock/fluxos'
import {criarProjeto, excluirProjeto, listarProjetos, type Projeto} from '@/mock/projetos'
import {Button} from '@/ui/button'
import {inputCampo} from '@/ui/campo-expression'
import {cn} from '@/lib/utils'
import {Cabecalho, dataCurta} from './cabecalho'

/** Página inicial: os projetos. Cada projeto tem fluxos, execuções, segredos e arquivos. */
export function ListaDeProjetos() {
  const navegar = useNavigate()
  const [projetos, setProjetos] = useState(listarProjetos)
  const [criando, setCriando] = useState(false)
  const [nome, setNome] = useState('')
  const [descricao, setDescricao] = useState('')

  function criar(e: FormEvent) {
    e.preventDefault()
    if (!nome.trim()) return
    const projeto = criarProjeto(nome.trim(), descricao.trim())
    navegar(`/projetos/${projeto.id}`)
  }

  function excluir(p: Projeto) {
    const qtd = fluxosDoProjeto(p.id).length
    if (qtd > 0) {
      window.alert(`O projeto "${p.nome}" tem ${qtd} fluxo(s). Exclua ou mova os fluxos antes.`)
      return
    }
    if (!window.confirm(`Excluir o projeto "${p.nome}"?`)) return
    excluirProjeto(p.id)
    setProjetos(listarProjetos())
  }

  return (
    <div className="min-h-dvh bg-background">
      <Cabecalho>
        <Button size="sm" onClick={() => setCriando(true)}><Plus className="size-4" aria-hidden="true"/> Novo projeto</Button>
      </Cabecalho>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
        <h1 className="text-2xl font-semibold">Projetos</h1>

        {criando && (
          <form onSubmit={criar} className="flex flex-col gap-3 rounded-xl border border-primary/60 bg-card p-5 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Nome</span>
              <input autoFocus value={nome} onChange={e => setNome(e.target.value)} placeholder="Integração do ERP" className={inputCampo}/>
            </label>
            <label className="flex flex-[2] flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Descrição</span>
              <input value={descricao} onChange={e => setDescricao(e.target.value)} className={inputCampo}/>
            </label>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={!nome.trim()}>Criar</Button>
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => setCriando(false)} aria-label="Cancelar"><X className="size-4"/></Button>
            </div>
          </form>
        )}

        <ul className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
          {projetos.map(p => {
            const fluxos = fluxosDoProjeto(p.id)
            return (
              <li key={p.id}>
                <article className="group flex h-full flex-col gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/60">
                  <div className="flex items-start gap-3">
                    <FolderKanban className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true"/>
                    <div className="min-w-0 flex-1">
                      <Link to={`/projetos/${p.id}`} className="text-base font-semibold hover:underline">{p.nome}</Link>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{p.descricao || 'Sem descrição.'}</p>
                    </div>
                  </div>
                  <ul className="flex flex-wrap gap-1.5">
                    {fluxos.slice(0, 4).map(f => (
                      <li key={f.id} className="max-w-full truncate rounded-md bg-muted px-2 py-0.5 text-sm text-muted-foreground">{f.nome}</li>
                    ))}
                    {fluxos.length > 4 && <li className="px-1 text-sm text-muted-foreground">+{fluxos.length - 4}</li>}
                  </ul>
                  <div className="mt-auto flex items-center gap-3 border-t border-border pt-3 text-sm text-muted-foreground">
                    <span className={cn(fluxos.length === 0 && 'italic')}>{fluxos.length} fluxo(s)</span>
                    <span>{dataCurta(p.atualizadoEm)}</span>
                    <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={() => excluir(p)} aria-label="Excluir projeto" title="Excluir projeto">
                      <Trash2 className="size-4"/>
                    </Button>
                  </div>
                </article>
              </li>
            )
          })}
        </ul>
      </main>
    </div>
  )
}
