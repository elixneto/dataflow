import {Layers} from 'lucide-react'
import {aggregate, configDoAggregate, MAX_TAMANHO_DO_LOTE} from '@dataflow/core'
import {CampoDaChave, inputCampo} from '@/ui/campo-expression'
import {cn} from '@/lib/utils'
import type {CamposProps, ComponenteDef} from './tipos'

// Parte visual do Aggregate. A lógica é a do core.

function CardAggregate({config}: CamposProps) {
  const {tamanho, campo} = configDoAggregate(config)
  return <p className="font-mono text-xs"><span className="font-semibold">{campo}</span>: <span className="text-muted-foreground">lotes de</span> {tamanho}</p>
}

function PainelAggregate({id, config, setConfig}: CamposProps) {
  const {tamanho, campo} = configDoAggregate(config)
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
      <label htmlFor={`${id}-tamanho`} className="text-xs font-medium text-muted-foreground">Tamanho do lote</label>
      <input id={`${id}-tamanho`} type="number" min={1} max={MAX_TAMANHO_DO_LOTE} value={tamanho}
             onChange={e => setConfig('tamanho', Math.min(MAX_TAMANHO_DO_LOTE, Math.max(1, Math.round(Number(e.target.value) || 1))))}
             className={cn(inputCampo, 'w-28 font-mono')}/>
      <label htmlFor={`${id}-campo`} className="text-xs font-medium text-muted-foreground">Chave no envelope</label>
      <CampoDaChave id={`${id}-campo`} valor={campo} onValor={v => setConfig('campo', v)} placeholder="items" className="w-44"/>
    </div>
  )
}

function DocumentacaoAggregate() {
  return (
    <>
      <p>Junta os envelopes em lotes e solta um envelope por lote, com a lista dos <code>DATA</code> num campo.</p>
      <pre>{`{items: [{id: 1, ...}, {id: 2, ...}, ...]}`}</pre>
      <p>Serve para mandar vários registros de uma vez para uma API ou um banco: Aggregate de 500 → TypeScript que faz uma chamada por lote com <code>$input.items</code>.</p>
      <h4>Entrada</h4>
      <p>1 porta de envelopes.</p>
      <h4>Saída</h4>
      <p>1 envelope a cada N que entram; o último lote pode vir menor. Para voltar a um envelope por registro, o TypeScript pode devolver uma lista.</p>
      <h4>Desativado</h4>
      <p>Os envelopes passam sem juntar.</p>
    </>
  )
}

export const AGGREGATE: ComponenteDef = {
  tipo: aggregate.tipo,
  rotulo: 'Aggregate',
  descricao: 'Junta os envelopes em lotes',
  categoria: 'transformacao',
  icone: Layers,
  entradas: aggregate.entradas,
  saidas: aggregate.saidas,
  semErro: true,
  configPadrao: {tamanho: 500, campo: 'items'},
  Card: CardAggregate,
  Painel: PainelAggregate,
  Documentacao: DocumentacaoAggregate,
  validar: config => aggregate.validar(config),
}
