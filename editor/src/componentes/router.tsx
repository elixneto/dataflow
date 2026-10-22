import {Plus, Split, X} from 'lucide-react'
import {useReactFlow} from '@xyflow/react'
import {casosDoRouter, portaElseDoRouter, router, type CasoDoRouter} from '@dataflow/core'
import {inputCampo} from '@/ui/campo-expression'
import {cn} from '@/lib/utils'
import type {CamposProps, ComponenteDef, Config} from './tipos'

// Parte visual do Router. A lógica (validar e executar) é a do core.

const rotuloDoCaso = (c: CasoDoRouter, i: number) => c.rotulo.trim() || `caso ${i + 1}`

function CardRouter({config}: CamposProps) {
  const casos = casosDoRouter(config)
  if (casos.length === 0) return <p className="text-xs italic text-muted-foreground">Nenhum caso</p>
  return (
    <ul className="flex flex-col gap-1">
      {casos.slice(0, 6).map((c, i) => (
        <li key={i} className="flex min-w-0 items-baseline gap-1.5 font-mono text-xs">
          <span className="shrink-0 font-semibold">{rotuloDoCaso(c, i)}:</span>
          <span className="min-w-0 truncate text-primary" title={c.condicao}>{c.condicao || '?'}</span>
        </li>
      ))}
      {casos.length > 6 && <li className="text-xs text-muted-foreground">+{casos.length - 6} casos</li>}
    </ul>
  )
}

/**
 * Casos em lista (rótulo + condição). As saídas seguem a ordem dos casos e a else é a última, então incluir ou
 * tirar um caso renumera as ligações que saem do Router para cada uma continuar no mesmo caso.
 */
function PainelRouter({noId: id, config, setConfig}: CamposProps) {
  const {setEdges} = useReactFlow()
  const casos = casosDoRouter(config)
  const alterar = (i: number, mudanca: Partial<CasoDoRouter>) => setConfig('casos', casos.map((c, j) => (j === i ? {...c, ...mudanca} : c)))

  function incluir() {
    const elseAntes = portaElseDoRouter(config)
    setConfig('casos', [...casos, {rotulo: '', condicao: ''}])
    setEdges(lista => lista.map(e => (e.source === id && e.sourceHandle === elseAntes ? {...e, sourceHandle: `out-${casos.length + 1}`} : e)))
  }

  function tirar(i: number) {
    setConfig('casos', casos.filter((_, j) => j !== i))
    setEdges(lista => lista
      .filter(e => !(e.source === id && e.sourceHandle === `out-${i}`))
      .map(e => {
        const n = e.source === id ? Number(e.sourceHandle?.match(/^out-(\d+)$/)?.[1]) : NaN
        return n > i ? {...e, sourceHandle: `out-${n - 1}`} : e
      }))
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col overflow-hidden rounded-md border border-border">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_32px] items-center gap-x-1.5 border-b border-border bg-muted/50 px-2 py-1.5 text-xs font-medium text-muted-foreground">
          <span>Saída</span><span>Condição</span><span/>
        </div>
        {casos.map((c, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_32px] items-center gap-x-1.5 border-b border-border px-2 py-1.5">
            <input value={c.rotulo} onChange={e => alterar(i, {rotulo: e.target.value})} placeholder={`caso ${i + 1}`}
                   aria-label={`Nome da saída do caso ${i + 1}`} className={inputCampo}/>
            <input value={c.condicao} onChange={e => alterar(i, {condicao: e.target.value})} placeholder='$uf === "SP"' spellCheck={false}
                   aria-label={`Condição do caso ${i + 1}`} className={cn(inputCampo, 'border-primary/50 bg-primary/5 font-mono')}/>
            <button type="button" onClick={() => tirar(i)} aria-label={`Remover caso ${i + 1}`}
                    className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
              <X className="size-4" aria-hidden="true"/>
            </button>
          </div>
        ))}
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_32px] items-center gap-x-1.5 px-2 py-2 text-xs text-muted-foreground">
          <span className="px-2 font-mono">else</span><span>nenhum caso deu verdadeiro</span><span/>
        </div>
      </div>
      <button type="button" onClick={incluir}
              className="flex h-8 items-center justify-center gap-1 rounded-md border border-dashed border-input text-xs text-muted-foreground hover:border-ring hover:text-foreground">
        <Plus className="size-3.5" aria-hidden="true"/> Adicionar caso
      </button>
    </div>
  )
}

function DocumentacaoRouter() {
  return (
    <>
      <p>Manda cada envelope para a saída do primeiro caso cuja condição der verdadeiro, na ordem da lista. Não mexe no <code>DATA</code>.</p>
      <h4>Entrada</h4>
      <p>1 porta de envelopes.</p>
      <h4>Saídas</h4>
      <p>Uma por caso, na ordem da lista, com o nome do caso ao lado da porta, e a <code>else</code> por último, para o envelope em que nenhum caso deu verdadeiro. As dos casos precisam estar ligadas; a <code>else</code> pode ficar sem ligação, e o que sai por ela é descartado.</p>
      <h4>Condição</h4>
      <p>Expression em JS, como no Filter: valem <code>$PARAMETERS</code>, <code>$WORKFLOW_CURRENT_RUN</code> e cada campo do envelope. Ex.: <code>{'$uf === "SP"'}</code>, <code>{'["PR", "SC", "RS"].includes($uf)'}</code>.</p>
      <p>Um envelope sai por uma saída só: se dois casos derem verdadeiro, vale o de cima.</p>
      <h4>Desativado</h4>
      <p>Todos os envelopes saem pela primeira saída.</p>
      <h4>Erros</h4>
      <p>Condição que falha é erro do envelope e segue a política "Em caso de erro" do card.</p>
    </>
  )
}

export const ROUTER: ComponenteDef = {
  tipo: router.tipo,
  rotulo: 'Router',
  descricao: 'Manda cada envelope para o primeiro caso verdadeiro',
  categoria: 'transformacao',
  icone: Split,
  entradas: router.entradas,
  saidas: router.saidas,
  saidasDaConfig: (config: Config) => [...casosDoRouter(config).map((c, i) => ({rotulo: rotuloDoCaso(c, i)})), {rotulo: 'else'}],
  saidasOpcionais: router.saidasOpcionais,
  configPadrao: {casos: [{rotulo: '', condicao: ''}]},
  Card: CardRouter,
  Painel: PainelRouter,
  Documentacao: DocumentacaoRouter,
  validar: config => router.validar(config),
}
