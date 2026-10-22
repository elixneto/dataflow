import {useParams} from 'react-router'
import {Workflow} from 'lucide-react'
import {configDoWorkflowInvoker, MAX_PROFUNDIDADE_DE_WORKFLOWS, workflowInvoker, type ParametroDoInvoker} from '@dataflow/core'
import {CampoExpression, inputCampo} from '@/ui/campo-expression'
import {cn} from '@/lib/utils'
import {listarFluxos, obterFluxo, type Fluxo} from '@/mock/fluxos'
import type {CamposProps, ComponenteDef, Config} from './tipos'

// Parte visual do Workflow Invoker. A lógica é a do core; o editor manda os workflows chamados junto.

const inicioRecebeEntrada = (fluxo?: Fluxo) =>
  fluxo?.nodes.some(n => n.type === 'componente' && n.data.tipo === 'inicio' && n.data.config.recebeEntrada === true) ?? false

function CardWorkflow({config}: CamposProps) {
  const {workflowId, parametros} = configDoWorkflowInvoker(config)
  const alvo = workflowId ? obterFluxo(workflowId) : undefined
  if (!workflowId) return <p className="text-xs italic text-muted-foreground">Nenhum workflow</p>
  return (
    <div className="flex flex-col gap-1 text-xs">
      <p className={cn('truncate font-medium', !alvo && 'text-destructive')} title={alvo?.nome}>{alvo?.nome ?? 'Workflow não encontrado'}</p>
      {parametros.filter(p => p.valor).slice(0, 4).map(p => (
        <p key={p.nome} className="flex min-w-0 items-baseline gap-1.5 font-mono">
          <span className="shrink-0 font-semibold">{p.nome}:</span>
          <span className={cn('min-w-0 truncate', p.expression ? 'text-primary' : 'text-muted-foreground')} title={p.valor}>{p.expression ? p.valor : `"${p.valor}"`}</span>
        </p>
      ))}
    </div>
  )
}

function PainelWorkflow({id, config, setConfig}: CamposProps) {
  const {fluxoId} = useParams()
  const {workflowId, parametros, enviarEnvelope} = configDoWorkflowInvoker(config)
  const opcoes = listarFluxos().filter(f => f.id !== fluxoId).sort((a, b) => a.nome.localeCompare(b.nome))
  const alvo = opcoes.find(f => f.id === workflowId)
  const recebeEntrada = inicioRecebeEntrada(alvo)
  // uma linha por parâmetro do Start do workflow chamado, com o valor guardado (se houver)
  const linhas = (alvo?.parametros ?? []).map(p => ({
    def: p,
    valor: parametros.find(v => v.nome === p.nome) ?? {nome: p.nome, valor: '', expression: true},
  }))
  const alterar = (nome: string, mudanca: Partial<ParametroDoInvoker>) => {
    const atual = linhas.map(l => l.valor)
    setConfig('parametros', atual.map(v => (v.nome === nome ? {...v, ...mudanca} : v)))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
        <label htmlFor={`${id}-workflow`} className="text-xs font-medium text-muted-foreground">Workflow</label>
        <select id={`${id}-workflow`} value={workflowId} className={inputCampo}
                onChange={e => {
                  setConfig('workflowId', e.target.value)
                  setConfig('parametros', [])
                  if (!inicioRecebeEntrada(obterFluxo(e.target.value))) setConfig('enviarEnvelope', false)
                }}>
          <option value="">Escolha…</option>
          {workflowId && !alvo && <option value={workflowId}>(não encontrado)</option>}
          {opcoes.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
        </select>
      </div>

      {alvo && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">Parâmetros do Start</h3>
          <div className="flex flex-col overflow-hidden rounded-md border border-border">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-x-1.5 border-b border-border bg-muted/50 px-2 py-1.5 text-xs font-medium text-muted-foreground">
              <span>Parâmetro</span><span>Valor</span>
            </div>
            {linhas.map(({def, valor}) => (
              <div key={def.nome} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-x-1.5 border-b border-border px-2 py-1.5 last:border-b-0">
                <span className="truncate font-mono text-xs" title={`${def.tipo}${def.padrao ? `, padrão ${def.padrao}` : ''}`}>
                  {def.nome}{def.obrigatorio && <span className="text-destructive"> *</span>}
                </span>
                <CampoExpression rotulo={`Valor de ${def.nome}`} valor={valor.valor} expression={valor.expression}
                                 placeholder={def.padrao ? `padrão: ${def.padrao}` : undefined}
                                 onValor={v => alterar(def.nome, {valor: v})} onExpression={e => alterar(def.nome, {expression: e})}/>
              </div>
            ))}
            {linhas.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">O Start dele não tem parâmetros</p>}
          </div>
        </section>
      )}

      {alvo && (
        <label className={cn('flex items-center gap-2 text-sm', !recebeEntrada && 'opacity-50')}>
          <input type="checkbox" checked={enviarEnvelope && recebeEntrada} disabled={!recebeEntrada}
                 onChange={e => setConfig('enviarEnvelope', e.target.checked)} className="nodrag size-4"/>
          Enviar o envelope como entrada
        </label>
      )}
    </div>
  )
}

function DocumentacaoWorkflow() {
  return (
    <>
      <p>Roda outro workflow para cada envelope que chega, passando os parâmetros do Start dele. Assim um fluxo chama outro, que chama outro, e o tratamento de erro pode ser um workflow à parte.</p>
      <h4>Entrada</h4>
      <p>1 porta de envelopes. Cada envelope é uma chamada (ligado no Start, que solta um envelope, é uma chamada só).</p>
      <h4>Parâmetros</h4>
      <p>Aparecem os parâmetros do Start do workflow escolhido. O valor pode ser texto ou expression no envelope que chegou (ex.: <code>$codigoEmpresa</code>, <code>$PARAMETERS.desde</code>). Vazio usa o padrão do parâmetro; obrigatório (<code>*</code>) sem valor faz a chamada falhar.</p>
      <h4>Enviar o envelope como entrada</h4>
      <p>Só para workflow com "Recebe entrada" no Start: o <code>DATA</code> do envelope vira a entrada dele.</p>
      <h4>Saída</h4>
      <p>Cada envelope que chega ao End do outro workflow sai por aqui, com o <code>DATA</code> dele mesclado no do envelope que chamou. Com Override, só o <code>DATA</code> dele. Se nada chegar ao End dele, nada sai.</p>
      <h4>Erros</h4>
      <p>Se o outro workflow falhar, é erro do envelope que chamou e segue a política "Em caso de erro" do card. Com Desviar, ligue a porta de erro em outro Workflow Invoker para chamar o workflow de tratamento.</p>
      <p>Um workflow que chama a si mesmo (direto ou por outros) é barrado, e a sequência para em {MAX_PROFUNDIDADE_DE_WORKFLOWS} níveis. Parar a execução para os workflows chamados junto.</p>
      <h4>Resultado</h4>
      <p>Cada chamada aparece no log do componente, e o registro guarda o id, o status e o tempo de cada execução chamada.</p>
    </>
  )
}

export const WORKFLOW_INVOKER: ComponenteDef = {
  tipo: workflowInvoker.tipo,
  rotulo: 'Workflow Invoker',
  descricao: 'Chama outro workflow com os parâmetros do Start dele',
  categoria: 'fluxo',
  icone: Workflow,
  entradas: workflowInvoker.entradas,
  saidas: workflowInvoker.saidas,
  usaOverride: true,
  tamanhoDaJanela: {w: 620, h: 520},
  configPadrao: {workflowId: '', parametros: [], enviarEnvelope: false},
  Card: CardWorkflow,
  Painel: PainelWorkflow,
  Documentacao: DocumentacaoWorkflow,
  validar: (config: Config) => {
    const pendencias = workflowInvoker.validar(config)
    const {workflowId, parametros} = configDoWorkflowInvoker(config)
    const alvo = workflowId ? obterFluxo(workflowId) : undefined
    if (workflowId && !alvo) return [...pendencias, 'chama um workflow que não existe mais.']
    for (const p of alvo?.parametros ?? []) {
      const valor = parametros.find(v => v.nome === p.nome)?.valor ?? ''
      if (p.obrigatorio && !valor && !p.padrao) pendencias.push(`está sem valor para o parâmetro obrigatório "${p.nome}".`)
    }
    return pendencias
  },
}
