import {useCallback, useEffect, useRef, useState, type FormEvent} from 'react'
import {Link, useParams, useSearchParams} from 'react-router'
import {Download, KeyRound, RefreshCw, Trash2, Upload} from 'lucide-react'
import type {RegistroDaExecucao} from '@dataflow/core'
import {IconeDoStatus, ms, ROTULO_DO_STATUS} from '@/execucao/painel-da-execucao'
import {obterProjeto} from '@/mock/projetos'
import {Button} from '@/ui/button'
import {inputCampo} from '@/ui/campo-expression'
import {cn} from '@/lib/utils'
import {AbaFluxos} from './aba-fluxos'
import {Cabecalho, dataCurta} from './cabecalho'

type Aba = 'fluxos' | 'execucoes' | 'segredos' | 'arquivos'

const ABAS: [Aba, string][] = [['fluxos', 'Fluxos'], ['execucoes', 'Execuções'], ['segredos', 'Segredos'], ['arquivos', 'Arquivos']]

const API = '/api'

async function pedir<T>(caminho: string, init?: RequestInit): Promise<T> {
  let resposta: Response
  try {
    resposta = await fetch(`${API}${caminho}`, init)
  } catch {
    throw new Error('O runner não respondeu. Ele está rodando? (npm run start na raiz do repositório)')
  }
  const corpo = await resposta.json().catch(() => ({}))
  if (!resposta.ok) throw new Error(corpo.erro ?? `O runner devolveu ${resposta.status}.`)
  return corpo as T
}

/** Projeto: abas Fluxos, Execuções, Segredos e Arquivos (a aba fica na URL, ?aba=). */
export function PaginaDoProjeto() {
  const {projetoId = ''} = useParams()
  const [busca, setBusca] = useSearchParams()
  const aba = (ABAS.find(([valor]) => valor === busca.get('aba'))?.[0] ?? 'fluxos') as Aba
  const projeto = obterProjeto(projetoId)

  if (!projeto) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        Projeto não encontrado.
        <Link to="/" className="text-primary hover:underline">Voltar para os projetos</Link>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-background">
      <Cabecalho trilha={[{rotulo: projeto.nome}]}/>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
        <div>
          <h1 className="text-2xl font-semibold">{projeto.nome}</h1>
          {projeto.descricao && <p className="mt-1 text-sm text-muted-foreground">{projeto.descricao}</p>}
        </div>
        <div role="tablist" className="flex gap-1 border-b border-border">
          {ABAS.map(([valor, rotulo]) => (
            <button key={valor} type="button" role="tab" aria-selected={aba === valor} onClick={() => setBusca(valor === 'fluxos' ? {} : {aba: valor})}
                    className={cn('-mb-px border-b-2 px-4 py-2 text-sm transition-colors',
                      aba === valor ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
              {rotulo}
            </button>
          ))}
        </div>
        <div role="tabpanel">
          {aba === 'fluxos' && <AbaFluxos projetoId={projetoId}/>}
          {aba === 'execucoes' && <AbaExecucoes projetoId={projetoId}/>}
          {aba === 'segredos' && <AbaSegredos projetoId={projetoId}/>}
          {aba === 'arquivos' && <AbaArquivos projetoId={projetoId}/>}
        </div>
      </main>
    </div>
  )
}

function Erro({mensagem}: {mensagem: string | null}) {
  return mensagem ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{mensagem}</p> : null
}

function Vazio({children}: {children: string}) {
  return <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{children}</p>
}

// ---------- Execuções: as últimas do runner (em memória até ter banco) ----------

type ResumoDaExecucao = Omit<RegistroDaExecucao, 'componentes'> & {workflowId?: string}

function AbaExecucoes({projetoId}: {projetoId: string}) {
  const [lista, setLista] = useState<ResumoDaExecucao[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const carregar = useCallback(() => {
    setErro(null)
    pedir<ResumoDaExecucao[]>(`/execucoes?projeto=${encodeURIComponent(projetoId)}`).then(setLista).catch(e => setErro(e.message))
  }, [projetoId])
  useEffect(carregar, [carregar])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">As últimas 50 do runner, guardadas em memória (somem quando ele reinicia).</p>
        <Button variant="outline" size="sm" onClick={carregar}><RefreshCw className="size-4" aria-hidden="true"/> Atualizar</Button>
      </div>
      <Erro mensagem={erro}/>
      {lista && lista.length === 0 && <Vazio>Nenhuma execução deste projeto desde que o runner subiu.</Vazio>}
      {lista && lista.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-[20px_minmax(0,1fr)_160px_110px_90px_90px] gap-3 border-b border-border bg-muted/50 px-4 py-2 text-sm text-muted-foreground">
            <span/><span>Fluxo</span><span>Início</span><span>Situação</span><span className="text-right">Duração</span><span className="text-right">Id</span>
          </div>
          <ul>
            {lista.map(e => (
              <li key={e.run.id} className="border-b border-border last:border-b-0">
                <Link to={`/projetos/${projetoId}/execucoes/${e.run.id}`}
                      className="grid grid-cols-[20px_minmax(0,1fr)_160px_110px_90px_90px] items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent">
                  <IconeDoStatus status={e.status}/>
                  <span className="truncate font-medium">{e.run.workflow}{e.run.parentId && <span className="ml-2 text-muted-foreground">(chamado)</span>}</span>
                  <span className="text-muted-foreground">{dataCurta(e.run.startedAt)}</span>
                  <span className={cn(e.status === 'falhou' && 'text-destructive')}>{ROTULO_DO_STATUS[e.status]}</span>
                  <span className="text-right font-mono">{ms(e.duracaoMs)}</span>
                  <span className="text-right font-mono text-muted-foreground">{e.run.id.slice(0, 8)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ---------- Segredos: só os nomes; o valor vai para o runner e não volta ----------

type Segredo = {nome: string; origem: 'projeto' | 'compartilhado'}

function AbaSegredos({projetoId}: {projetoId: string}) {
  const [lista, setLista] = useState<Segredo[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [nome, setNome] = useState('')
  const [valor, setValor] = useState('')
  const base = `/projetos/${encodeURIComponent(projetoId)}/segredos`
  const carregar = useCallback(() => {
    pedir<Segredo[]>(base).then(setLista).catch(e => setErro(e.message))
  }, [base])
  useEffect(carregar, [carregar])

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    try {
      await pedir(`${base}/${encodeURIComponent(nome.trim())}`, {method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify({valor})})
      setNome('')
      setValor('')
      carregar()
    } catch (e) {
      setErro((e as Error).message)
    }
  }

  async function apagar(s: Segredo) {
    if (!window.confirm(`Apagar o segredo ${s.nome}?`)) return
    try {
      await pedir(`${base}/${encodeURIComponent(s.nome)}`, {method: 'DELETE'})
      carregar()
    } catch (e) {
      setErro((e as Error).message)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={salvar} className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-sm text-muted-foreground">Nome</span>
          <input value={nome} onChange={e => setNome(e.target.value)} placeholder="MEU_BANCO_SQL" spellCheck={false} className={cn(inputCampo, 'font-mono')}/>
        </label>
        <label className="flex flex-[2] flex-col gap-1">
          <span className="text-sm text-muted-foreground">Valor</span>
          <input type="password" value={valor} onChange={e => setValor(e.target.value)} autoComplete="new-password" className={cn(inputCampo, 'font-mono')}/>
        </label>
        <Button type="submit" size="sm" disabled={!nome.trim() || !valor}>Salvar</Button>
      </form>
      <Erro mensagem={erro}/>
      {lista && lista.length === 0 && <Vazio>Nenhum segredo. Os componentes usam como $SECRETS.NOME.</Vazio>}
      {lista && lista.length > 0 && (
        <ul className="overflow-hidden rounded-lg border border-border">
          {lista.map(s => (
            <li key={s.nome} className="flex items-center gap-3 border-b border-border px-4 py-2.5 text-sm last:border-b-0">
              <KeyRound className="size-4 text-muted-foreground" aria-hidden="true"/>
              <span className="font-mono">{s.nome}</span>
              <span className="font-mono text-muted-foreground">••••••••</span>
              <span className={cn('rounded-full px-2 py-0.5 text-sm', s.origem === 'projeto' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground')}
                    title={s.origem === 'compartilhado' ? 'Vale para todos os projetos (topo do secrets.local.json)' : undefined}>
                {s.origem === 'projeto' ? 'deste projeto' : 'compartilhado'}
              </span>
              {s.origem === 'projeto' && (
                <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={() => apagar(s)} aria-label={`Apagar ${s.nome}`}><Trash2 className="size-4"/></Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------- Arquivos: guardados no runner, por projeto ----------

type Arquivo = {nome: string; tamanho: number; atualizadoEm: string}

const tamanho = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`)

function AbaArquivos({projetoId}: {projetoId: string}) {
  const [lista, setLista] = useState<Arquivo[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const entrada = useRef<HTMLInputElement>(null)
  const base = `/projetos/${encodeURIComponent(projetoId)}/arquivos`
  const carregar = useCallback(() => {
    pedir<Arquivo[]>(base).then(setLista).catch(e => setErro(e.message))
  }, [base])
  useEffect(carregar, [carregar])

  async function enviar(arquivos: FileList | null) {
    if (!arquivos?.length) return
    setErro(null)
    setEnviando(true)
    try {
      for (const arquivo of arquivos) {
        const corpo = new FormData()
        corpo.append('arquivo', arquivo)
        await pedir(base, {method: 'POST', body: corpo})
      }
      carregar()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setEnviando(false)
      if (entrada.current) entrada.current.value = ''
    }
  }

  async function apagar(a: Arquivo) {
    if (!window.confirm(`Apagar ${a.nome}?`)) return
    await pedir(`${base}/${encodeURIComponent(a.nome)}`, {method: 'DELETE'}).catch(e => setErro(e.message))
    carregar()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <input ref={entrada} type="file" multiple className="hidden" onChange={e => enviar(e.target.files)}/>
        <Button size="sm" onClick={() => entrada.current?.click()} disabled={enviando}>
          <Upload className="size-4" aria-hidden="true"/> {enviando ? 'Enviando…' : 'Enviar arquivos'}
        </Button>
      </div>
      <Erro mensagem={erro}/>
      {lista && lista.length === 0 && <Vazio>Nenhum arquivo. Os CSVs que os fluxos leem ficam aqui.</Vazio>}
      {lista && lista.length > 0 && (
        <ul className="overflow-hidden rounded-lg border border-border">
          {lista.map(a => (
            <li key={a.nome} className="flex items-center gap-3 border-b border-border px-4 py-2.5 text-sm last:border-b-0">
              <span className="min-w-0 flex-1 truncate font-medium">{a.nome}</span>
              <span className="font-mono text-muted-foreground">{tamanho(a.tamanho)}</span>
              <span className="text-muted-foreground">{dataCurta(a.atualizadoEm)}</span>
              <a href={`${API}${base}/${encodeURIComponent(a.nome)}`} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={`Baixar ${a.nome}`} title="Baixar">
                <Download className="size-4"/>
              </a>
              <Button variant="ghost" size="icon-sm" onClick={() => apagar(a)} aria-label={`Apagar ${a.nome}`} title="Apagar"><Trash2 className="size-4"/></Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
