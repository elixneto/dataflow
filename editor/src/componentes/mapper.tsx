import {useRef, useState, type PointerEvent} from 'react'
import {ArrowRight, Plus, Shuffle, X} from 'lucide-react'
import {camposDoMapper, mapper, type CampoDoMapper} from '@dataflow/core'
import {CampoDaChave, CampoExpression} from '@/ui/campo-expression'
import type {CamposProps, ComponenteDef} from './tipos'

// Parte visual do Mapper. A lógica (validar e executar) é a do core.

function CardMapper({config}: CamposProps) {
  const campos = camposDoMapper(config)
  if (campos.length === 0) return <p className="text-xs italic text-muted-foreground">Nenhuma chave</p>
  return (
    <ul className="flex flex-col gap-1">
      {campos.slice(0, 4).map((c, i) => (
        <li key={i} className="flex min-w-0 items-baseline gap-1.5 font-mono text-xs">
          <span className="shrink-0 font-semibold">{c.destino || '?'}:</span>
          <span className={c.expression ? 'min-w-0 truncate text-primary' : 'min-w-0 truncate text-muted-foreground'} title={c.valor}>
            {c.expression ? c.valor : `"${c.valor}"`}
          </span>
        </li>
      ))}
      {campos.length > 4 && <li className="text-xs text-muted-foreground">+{campos.length - 4} chaves</li>}
    </ul>
  )
}

const CHAVE_DA_COLUNA = 'dataflow-fluxos-mapper-coluna-origem'

function lerLarguraDaOrigem() {
  try {
    const v = Number(localStorage.getItem(CHAVE_DA_COLUNA))
    return v >= 20 && v <= 85 ? v : 60
  } catch {
    return 60
  }
}

/** Tabela origem → destino. A divisória do cabeçalho redimensiona as colunas (fica lembrada no navegador). */
function PainelMapper({config, setConfig}: CamposProps) {
  const campos = camposDoMapper(config)
  const alterar = (i: number, mudanca: Partial<CampoDoMapper>) => setConfig('campos', campos.map((c, j) => (j === i ? {...c, ...mudanca} : c)))
  const [origemPct, setOrigemPct] = useState(lerLarguraDaOrigem)
  const tabelaRef = useRef<HTMLDivElement>(null)
  const arrastando = useRef(false)

  function moverDivisoria(e: PointerEvent<HTMLDivElement>) {
    if (!arrastando.current || !tabelaRef.current) return
    const r = tabelaRef.current.getBoundingClientRect()
    const pct = Math.min(Math.max(((e.clientX - r.left) / r.width) * 100, 20), 85)
    setOrigemPct(pct)
  }

  function soltarDivisoria() {
    arrastando.current = false
    try {
      localStorage.setItem(CHAVE_DA_COLUNA, String(Math.round(origemPct)))
    } catch {
      // sem storage: vale só até recarregar
    }
  }

  const colunas = {gridTemplateColumns: `minmax(0, ${origemPct}fr) 16px minmax(0, ${100 - origemPct}fr) 32px`}

  return (
    <div className="flex flex-col gap-3">
      <div ref={tabelaRef} className="flex flex-col overflow-hidden rounded-md border border-border">
        <div className="grid items-center gap-x-1.5 border-b border-border bg-muted/50 px-2 py-1.5 text-xs font-medium text-muted-foreground" style={colunas}>
          <span>Origem (valor)</span>
          {/* divisória entre as colunas (na coluna da seta): arraste para redimensionar, duplo clique volta ao padrão */}
          <div role="separator" aria-orientation="vertical" aria-label="Redimensionar colunas"
               onPointerDown={e => {
                 arrastando.current = true
                 e.currentTarget.setPointerCapture(e.pointerId)
               }}
               onPointerMove={moverDivisoria} onPointerUp={soltarDivisoria} onDoubleClick={() => setOrigemPct(60)}
               className="group flex h-5 cursor-col-resize touch-none justify-center">
            <span className="h-full w-px bg-border group-hover:w-0.5 group-hover:bg-primary"/>
          </div>
          <span>Chave no envelope</span>
          <span/>
        </div>
        {campos.map((c, i) => (
          <div key={i} className="grid items-center gap-x-1.5 border-b border-border px-2 py-1.5 last:border-b-0" style={colunas}>
            <CampoExpression rotulo={`Origem da linha ${i + 1}`} valor={c.valor} expression={c.expression}
                             onValor={valor => alterar(i, {valor})} onExpression={expression => alterar(i, {expression})}/>
            <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true"/>
            <CampoDaChave valor={c.destino} onValor={destino => alterar(i, {destino})} rotulo={`Chave no envelope da linha ${i + 1}`}/>
            <button type="button" onClick={() => setConfig('campos', campos.filter((_, j) => j !== i))} aria-label={`Remover linha ${i + 1}`}
                    className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
              <X className="size-4" aria-hidden="true"/>
            </button>
          </div>
        ))}
        {campos.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">Nenhuma linha</p>}
      </div>
      <button type="button" onClick={() => setConfig('campos', [...campos, {destino: '', valor: '', expression: true}])}
              className="flex h-8 items-center justify-center gap-1 rounded-md border border-dashed border-input text-xs text-muted-foreground hover:border-ring hover:text-foreground">
        <Plus className="size-3.5" aria-hidden="true"/> Adicionar linha
      </button>
    </div>
  )
}

function DocumentacaoMapper() {
  return (
    <>
      <p>Grava campos direto no envelope: cada linha leva um valor (origem) para um campo (destino), adicionando o campo ou trocando o valor se ele já existir.</p>
      <h4>Entrada</h4>
      <p>1 porta de envelopes. Cada envelope que chega passa pelo Mapper uma vez.</p>
      <h4>Saída</h4>
      <p>Os mesmos envelopes, com os campos gravados no envelope. Os próximos componentes leem cada campo como <code>$destino</code>.</p>
      <h4>Origem</h4>
      <p>Texto puro, ou expression em JS com o <code>=</code> ligado. Na expression valem <code>$PARAMETERS</code>, <code>$WORKFLOW_CURRENT_RUN</code> e cada campo do envelope que chegou (<code>$campo</code>).</p>
      <p>Ex.: <code>{'"ABACAXI"'}</code> → <code>campo</code> e, num Mapper seguinte, <code>{'$campo + " 123"'}</code> → <code>outroCampo</code> dão <code>{'{campo: "ABACAXI", outroCampo: "ABACAXI 123"}'}</code>.</p>
      <p>As linhas são avaliadas sobre o envelope que chegou: uma linha não enxerga o que outra linha do mesmo Mapper grava.</p>
      <h4>Override</h4>
      <p>Ligado, o envelope de saída leva só os campos deste Mapper.</p>
      <h4>Erros</h4>
      <p>Expression que falha (ex.: campo que não existe) é erro do envelope e segue a política "Em caso de erro" do card. Com Desviar, o envelope sai pela porta de erro com <code>{'$errors: [{error, message, component}]'}</code>.</p>
    </>
  )
}

export const MAPPER: ComponenteDef = {
  tipo: mapper.tipo,
  rotulo: 'Mapper',
  descricao: 'Grava campos no envelope (origem → destino)',
  categoria: 'transformacao',
  icone: Shuffle,
  entradas: mapper.entradas,
  saidas: mapper.saidas,
  usaOverride: true,
  configPadrao: {campos: [{destino: '', valor: '', expression: true}]},
  Card: CardMapper,
  Painel: PainelMapper,
  Documentacao: DocumentacaoMapper,
  validar: config => mapper.validar(config),
}
