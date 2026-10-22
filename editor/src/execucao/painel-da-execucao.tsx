import {useState, type ReactNode} from 'react'
import {ChevronDown, ChevronRight, CircleAlert, CircleCheck, CircleMinus, CircleX, Clock, X} from 'lucide-react'
import type {ExecucaoDoComponente, RegistroDaExecucao} from '@dataflow/core'
import {cn} from '@/lib/utils'
import {POR_TIPO} from '@/componentes/catalogo'

type Aba = 'logs' | 'metricas' | 'dados'

export const ROTULO_DO_STATUS: Record<RegistroDaExecucao['status'], string> = {
  concluida: 'Concluída',
  'com-avisos': 'Concluída com avisos',
  'com-erros': 'Concluída com erros',
  falhou: 'Falhou',
}

const ROTULO_DO_COMPONENTE: Record<ExecucaoDoComponente['status'], string> = {
  'nao-executou': 'Não executou',
  concluido: 'Concluído',
  desativado: 'Desativado (bypass)',
  'com-avisos': 'Com avisos',
  'com-erros': 'Com erros',
  falhou: 'Falhou',
}

export const ms = (valor?: number) => (valor === undefined ? '—' : valor < 1000 ? `${valor} ms` : `${(valor / 1000).toFixed(2)} s`)
/** Tempo ativo: abaixo de 10 ms vale mostrar a fração (a maioria dos componentes fica em décimos de ms). */
const msAtivo = (valor?: number) => (valor === undefined ? '—' : valor < 10 ? `${valor.toLocaleString('pt-BR', {maximumFractionDigits: 2})} ms` : ms(Math.round(valor)))
const bytes = (valor: number) => (valor < 1024 ? `${valor} B` : valor < 1024 ** 2 ? `${(valor / 1024).toFixed(1)} KB` : `${(valor / 1024 ** 2).toFixed(1)} MB`)
const hora = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', {hour12: false}) + '.' + String(new Date(iso).getMilliseconds()).padStart(3, '0') : '—')
const total = (porta: Record<string, number>) => Object.values(porta).reduce((s, n) => s + n, 0)
/** Nome legível de uma porta do nó (ex.: "SP", "false", "entrada 2", "erro"). */
export type NomeDaPorta = (noId: string, porta: string) => string

/** Total grande e, se passou por mais de uma porta, quanto foi por cada uma embaixo. */
function Contagem({porta, noId, nomeDaPorta, semPortas}: {porta: Record<string, number>; noId: string; nomeDaPorta: NomeDaPorta; semPortas: boolean}) {
  if (semPortas) return <span className="text-right font-mono text-xs text-muted-foreground">—</span>
  const portas = Object.entries(porta)
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span className="font-mono text-xs">{total(porta)}</span>
      {portas.length > 1 && (
        <span className="flex flex-wrap justify-end gap-1">
          {portas.map(([p, n]) => (
            <span key={p} className={cn('rounded px-1.5 text-xs', p === 'erro' ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground')}>
              {nomeDaPorta(noId, p)}: <span className="font-mono text-foreground">{n}</span>
            </span>
          ))}
        </span>
      )}
    </span>
  )
}

export function IconeDoStatus({status}: {status: ExecucaoDoComponente['status'] | RegistroDaExecucao['status']}) {
  if (status === 'concluido' || status === 'concluida') return <CircleCheck className="size-4 shrink-0 text-entity" aria-label="Concluído"/>
  if (status === 'com-avisos') return <CircleAlert className="size-4 shrink-0 text-comentario" aria-label="Com avisos"/>
  if (status === 'com-erros') return <CircleAlert className="size-4 shrink-0 text-destructive" aria-label="Com erros"/>
  if (status === 'falhou') return <CircleX className="size-4 shrink-0 text-destructive" aria-label="Falhou"/>
  if (status === 'desativado') return <CircleMinus className="size-4 shrink-0 text-muted-foreground" aria-label="Desativado"/>
  return <Clock className="size-4 shrink-0 text-muted-foreground" aria-label="Não executou"/>
}

function Json({valor}: {valor: unknown}) {
  return (
    <pre className="max-h-56 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-xs leading-relaxed">
      {JSON.stringify(valor, null, 2)}
    </pre>
  )
}

// ---------- Logs: todos os componentes, em ordem de hora ----------

function AbaLogs({registro}: {registro: RegistroDaExecucao}) {
  const linhas = registro.componentes
    .flatMap((c, ordem) => c.logs.map(l => ({...l, ordem: ordem + 1, rotulo: c.rotulo})))
    .sort((a, b) => a.em.localeCompare(b.em) || a.ordem - b.ordem)
  if (linhas.length === 0) return <p className="px-4 py-3 text-sm text-muted-foreground">Nenhum log.</p>
  return (
    <ul className="flex flex-col gap-0.5 px-4 py-2 font-mono text-xs">
      {linhas.map((l, i) => (
        <li key={i} className={cn(l.nivel === 'erro' && 'text-destructive', l.nivel === 'aviso' && 'text-comentario')}>
          <span className="text-muted-foreground">{hora(l.em)}</span>{' '}
          <span className="text-muted-foreground">[{l.ordem} {l.rotulo}]</span> {l.mensagem}
        </li>
      ))}
    </ul>
  )
}

// ---------- Métricas: uma linha por componente ----------

const COLUNAS_METRICAS = 'grid-cols-[16px_minmax(0,1fr)_110px_120px_minmax(90px,200px)_minmax(90px,200px)_80px_80px_100px_110px]'

/** Nome do componente (Mapper, Filter...); o rótulo é o que o usuário deu ao nó. */
const nomeDoComponente = (tipo: string) => POR_TIPO[tipo]?.rotulo ?? tipo

function AbaMetricas({registro, onIrPara, nomeDaPorta}: {registro: RegistroDaExecucao; onIrPara: (noId: string) => void; nomeDaPorta: NomeDaPorta}) {
  return (
    <div className="flex flex-col">
      <div className={cn('grid gap-2 border-b border-border px-4 py-1.5 text-xs text-muted-foreground', COLUNAS_METRICAS)}>
        <span/><span>Label</span><span>Componente</span><span>Situação</span><span className="text-right">Entrou</span><span className="text-right">Saiu</span>
        <span className="text-right" title="Do primeiro ao último envelope, contando a espera">Duração</span>
        <span className="text-right" title="Tempo processando, sem a espera por envelopes nem pelo próximo componente (praticamente o CPU do componente)">Ativo</span>
        <span className="text-right" title="Pico do que o componente guardou de uma vez (ex.: tabela do Lookup, lote do Aggregate); tamanho estimado pelo JSON">Memória</span>
        <span className="text-right">Início</span>
      </div>
      <ul>
        {registro.componentes.map((c, i) => (
          <li key={c.noId} className="border-b border-border last:border-b-0">
            <button type="button" onClick={() => onIrPara(c.noId)} title="Ver na prancheta"
                    className={cn('grid w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-accent', COLUNAS_METRICAS)}>
              <IconeDoStatus status={c.status}/>
              <span className="truncate font-medium"><span className="mr-2 font-mono text-xs text-muted-foreground">{i + 1}</span>{c.rotulo}</span>
              <span className="truncate text-xs text-muted-foreground">{nomeDoComponente(c.tipo)}</span>
              <span className="truncate text-xs text-muted-foreground">{ROTULO_DO_COMPONENTE[c.status]}</span>
              <Contagem porta={c.entradas} noId={c.noId} nomeDaPorta={nomeDaPorta} semPortas={c.tipo === 'inicio' && total(c.entradas) === 0}/>
              <Contagem porta={c.saidas} noId={c.noId} nomeDaPorta={nomeDaPorta} semPortas={c.tipo === 'fim'}/>
              <span className="text-right font-mono text-xs">{ms(c.duracaoMs)}</span>
              <span className="text-right font-mono text-xs">{msAtivo(c.tempoAtivoMs)}</span>
              {c.memoria
                ? <span className="flex flex-col items-end gap-0.5 font-mono text-xs">
                    <span>{bytes(c.memoria.picoDeBytes)}</span>
                    <span className="text-muted-foreground">{c.memoria.picoDeEnvelopes.toLocaleString('pt-BR')} env.</span>
                  </span>
                : <span className="text-right font-mono text-xs text-muted-foreground">—</span>}
              <span className="text-right font-mono text-xs text-muted-foreground">{hora(c.inicio)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------- Dados: prévia de entrada e saída de cada componente ----------

function AbaDados({registro}: {registro: RegistroDaExecucao}) {
  const [abertos, setAbertos] = useState<Set<string>>(() => new Set(registro.componentes.slice(1, 2).map(c => c.noId)))
  const alternar = (id: string) => setAbertos(atual => {
    const proximo = new Set(atual)
    if (proximo.has(id)) proximo.delete(id)
    else proximo.add(id)
    return proximo
  })
  return (
    <ul>
      {registro.componentes.map((c, i) => {
        const aberto = abertos.has(c.noId)
        const portas = Object.keys(c.amostraDeSaida)
        return (
          <li key={c.noId} className="border-b border-border last:border-b-0">
            <button type="button" onClick={() => alternar(c.noId)} aria-expanded={aberto}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-accent">
              {aberto ? <ChevronDown className="size-4 text-muted-foreground"/> : <ChevronRight className="size-4 text-muted-foreground"/>}
              <IconeDoStatus status={c.status}/>
              <span className="font-mono text-xs text-muted-foreground">{i + 1}</span>
              <span className="truncate font-medium">{c.rotulo}</span>
              <span className="ml-auto font-mono text-xs text-muted-foreground">{total(c.entradas)} ⟶ {total(c.saidas)}</span>
            </button>
            {aberto && (
              <div className="grid gap-3 px-10 pb-4 pt-1 text-xs lg:grid-cols-2">
                <div>
                  <h4 className="mb-1 font-medium text-muted-foreground">Entrada (até 20)</h4>
                  {c.amostraDeEntrada.length ? <Json valor={c.amostraDeEntrada}/> : <p className="text-muted-foreground">Nada entrou.</p>}
                </div>
                <div>
                  <h4 className="mb-1 font-medium text-muted-foreground">{portas.length > 1 ? 'Saída por porta' : 'Saída'} (até 20)</h4>
                  {portas.length === 0 ? <p className="text-muted-foreground">Nada saiu.</p>
                    // uma porta só (o normal): mostra os envelopes direto, sem o "out-0" em volta
                    : portas.length === 1 ? <Json valor={c.amostraDeSaida[portas[0]]}/>
                      : <Json valor={c.amostraDeSaida}/>}
                </div>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Resultado de uma execução em abas: Logs (todos, por hora), Métricas (por componente) e Dados (entrada e saída). */
export function ResultadoDaExecucao({registro, onIrPara, nomeDaPorta, acoes}: {
  registro: RegistroDaExecucao
  onIrPara: (noId: string) => void
  nomeDaPorta: NomeDaPorta
  /** botões à direita das abas (ex.: fechar o painel) */
  acoes?: ReactNode
}) {
  const [aba, setAba] = useState<Aba>('logs')

  return (
    <>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2 text-sm">
        <IconeDoStatus status={registro.status}/>
        <span className="font-medium">{ROTULO_DO_STATUS[registro.status]}</span>
        <span className="font-mono text-xs text-muted-foreground" title="WORKFLOW_CURRENT_RUN.id">{registro.run.id.slice(0, 8)}</span>
        <span className="text-xs text-muted-foreground">startedAt <span className="font-mono text-foreground">{registro.run.startedAt}</span></span>
        <span className="text-xs text-muted-foreground">total <span className="font-mono text-foreground">{ms(registro.duracaoMs)}</span></span>
        <div role="tablist" className="ml-auto flex gap-1">
          {([['logs', 'Logs'], ['metricas', 'Métricas'], ['dados', 'Dados']] as const).map(([valor, rotulo]) => (
            <button key={valor} type="button" role="tab" aria-selected={aba === valor} onClick={() => setAba(valor)}
                    className={cn('rounded-md px-3 py-1 text-sm transition-colors',
                      aba === valor ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {rotulo}
            </button>
          ))}
        </div>
        {acoes}
      </header>
      {registro.erro && <p className="border-b border-border bg-destructive/10 px-4 py-2 text-sm text-destructive">{registro.erro}</p>}
      <div role="tabpanel" className="min-h-0 overflow-y-auto">
        {aba === 'logs' && <AbaLogs registro={registro}/>}
        {aba === 'metricas' && <AbaMetricas registro={registro} onIrPara={onIrPara} nomeDaPorta={nomeDaPorta}/>}
        {aba === 'dados' && <AbaDados registro={registro}/>}
      </div>
    </>
  )
}

/** O resultado no rodapé do editor, logo depois de executar. */
export function PainelDaExecucao({registro, onFechar, onIrPara, nomeDaPorta}: {
  registro: RegistroDaExecucao
  onFechar: () => void
  onIrPara: (noId: string) => void
  nomeDaPorta: NomeDaPorta
}) {
  return (
    <section className="absolute inset-x-0 bottom-0 z-20 flex max-h-[55%] flex-col border-t border-border bg-sidebar shadow-2xl" aria-label="Resultado da execução">
      <ResultadoDaExecucao registro={registro} onIrPara={onIrPara} nomeDaPorta={nomeDaPorta} acoes={
        <button type="button" onClick={onFechar} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Fechar resultado">
          <X className="size-4" aria-hidden="true"/>
        </button>
      }/>
    </section>
  )
}
