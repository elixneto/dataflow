import {Funnel} from 'lucide-react'
import {condicaoDoFilter, filter} from '@dataflow/core'
import {inputCampo} from '@/ui/campo-expression'
import {cn} from '@/lib/utils'
import type {CamposProps, ComponenteDef} from './tipos'

// Parte visual do Filter. A lógica (validar e executar) é a do core.

function CardFilter({config}: CamposProps) {
  const condicao = condicaoDoFilter(config)
  if (!condicao.trim()) return <p className="text-xs italic text-muted-foreground">Sem condição</p>
  return <p className="truncate font-mono text-xs text-primary" title={condicao}>{condicao}</p>
}

function PainelFilter({id, config, setConfig}: CamposProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-condicao`} className="text-xs font-medium text-muted-foreground">Condição</label>
      <textarea id={`${id}-condicao`} value={condicaoDoFilter(config)} onChange={e => setConfig('condicao', e.target.value)}
                rows={3} placeholder="$preco > 10" spellCheck={false}
                className={cn(inputCampo, 'h-auto resize-y border-primary/50 bg-primary/5 py-1.5 font-mono')}/>
    </div>
  )
}

function DocumentacaoFilter() {
  return (
    <>
      <p>Avalia uma condição para cada envelope e manda o envelope para a saída <code>true</code> ou <code>false</code>. Não mexe no <code>DATA</code>.</p>
      <h4>Entrada</h4>
      <p>1 porta de envelopes.</p>
      <h4>Saídas</h4>
      <p><code>true</code> (em cima): envelopes em que a condição deu verdadeiro. <code>false</code> (embaixo): o resto. A <code>false</code> pode ficar sem ligação: o que sai por ela é descartado.</p>
      <h4>Condição</h4>
      <p>Expression em JS. Valem <code>$PARAMETERS</code>, <code>$WORKFLOW_CURRENT_RUN</code> e cada campo do envelope (<code>$campo</code>).</p>
      <p>Ex.: <code>{'$preco > 10'}</code>, <code>{'$status === "ATIVO" && $email'}</code>, <code>{'$nome.startsWith("A")'}</code>.</p>
      <p>Vale a regra do JS: <code>0</code>, <code>{'""'}</code>, <code>null</code> e <code>undefined</code> contam como falso.</p>
      <h4>Desativado</h4>
      <p>Todos os envelopes saem pela <code>true</code>.</p>
      <h4>Erros</h4>
      <p>Condição que falha (ex.: <code>$naoExiste.campo</code>) é erro do envelope e segue a política "Em caso de erro" do card.</p>
    </>
  )
}

export const FILTER: ComponenteDef = {
  tipo: filter.tipo,
  rotulo: 'Filter',
  descricao: 'Separa os envelopes em true e false',
  categoria: 'transformacao',
  icone: Funnel,
  entradas: filter.entradas,
  saidas: filter.saidas,
  rotulosDasSaidas: ['true', 'false'],
  saidasOpcionais: filter.saidasOpcionais,
  configPadrao: {condicao: ''},
  Card: CardFilter,
  Painel: PainelFilter,
  Documentacao: DocumentacaoFilter,
  validar: config => filter.validar(config),
}
