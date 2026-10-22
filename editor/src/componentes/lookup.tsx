import {Equal, Plus, SearchCheck, X} from 'lucide-react'
import {configDoLookup, lookup, type ChaveDoLookup, type SeNaoEncontrar} from '@dataflow/core'
import {inputCampo} from '@/ui/campo-expression'
import {cn} from '@/lib/utils'
import type {CamposProps, ComponenteDef} from './tipos'

// Parte visual do Lookup. A lógica (validar e executar) é a do core.

const expressao = cn(inputCampo, 'border-primary/50 bg-primary/5 font-mono')

function CardLookup({config}: CamposProps) {
  const {chaves, seNaoEncontrar} = configDoLookup(config)
  if (chaves.length === 0) return <p className="text-xs italic text-muted-foreground">Sem comparação</p>
  return (
    <div className="flex flex-col gap-1 font-mono text-xs">
      {chaves.map((c, i) => (
        <p key={i} className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 truncate text-primary" title={c.principal}>{c.principal || '?'}</span>
          <Equal className="size-3 shrink-0 text-muted-foreground" aria-label="igual a"/>
          <span className="min-w-0 truncate text-primary" title={c.consulta}>{c.consulta || '?'}</span>
        </p>
      ))}
      <p className="text-muted-foreground">se não achar: {seNaoEncontrar === 'erro' ? 'erro' : 'null'}</p>
    </div>
  )
}

function BotaoRemover({rotulo, onClick}: {rotulo: string; onClick: () => void}) {
  return (
    <button type="button" onClick={onClick} aria-label={rotulo}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
      <X className="size-4" aria-hidden="true"/>
    </button>
  )
}

function BotaoAdicionar({children, onClick}: {children: string; onClick: () => void}) {
  return (
    <button type="button" onClick={onClick}
            className="flex h-8 items-center justify-center gap-1 rounded-md border border-dashed border-input text-xs text-muted-foreground hover:border-ring hover:text-foreground">
      <Plus className="size-3.5" aria-hidden="true"/> {children}
    </button>
  )
}

const SE_NAO_ENCONTRAR: {valor: SeNaoEncontrar; rotulo: string}[] = [
  {valor: 'nulo', rotulo: 'Gravar null'},
  {valor: 'erro', rotulo: 'Erro'},
]

function PainelLookup({id, config, setConfig}: CamposProps) {
  const {chaves, seNaoEncontrar} = configDoLookup(config)
  const alterarChave = (i: number, m: Partial<ChaveDoLookup>) => setConfig('chaves', chaves.map((c, j) => (j === i ? {...c, ...m} : c)))
  const colunasDaChave = 'grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)_32px]'

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">Comparação</h3>
        <div className="flex flex-col overflow-hidden rounded-md border border-border">
          <div className={cn('grid items-center gap-x-1.5 border-b border-border bg-muted/50 px-2 py-1.5 text-xs font-medium text-muted-foreground', colunasDaChave)}>
            <span>input</span><span/><span>lookup</span><span/>
          </div>
          {chaves.map((c, i) => (
            <div key={i} className={cn('grid items-center gap-x-1.5 border-b border-border px-2 py-1.5 last:border-b-0', colunasDaChave)}>
              <input value={c.principal} onChange={e => alterarChave(i, {principal: e.target.value})} placeholder="$codigoEmpresa" spellCheck={false}
                     aria-label={`Comparação ${i + 1} no input`} className={expressao}/>
              <Equal className="size-4 text-muted-foreground" aria-hidden="true"/>
              <input value={c.consulta} onChange={e => alterarChave(i, {consulta: e.target.value})} placeholder="$codigo" spellCheck={false}
                     aria-label={`Comparação ${i + 1} no lookup`} className={expressao}/>
              <BotaoRemover rotulo={`Remover comparação ${i + 1}`} onClick={() => setConfig('chaves', chaves.filter((_, j) => j !== i))}/>
            </div>
          ))}
          {chaves.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">Nenhuma comparação</p>}
        </div>
        <BotaoAdicionar onClick={() => setConfig('chaves', [...chaves, {principal: '', consulta: ''}])}>Adicionar comparação</BotaoAdicionar>
      </section>

      <section className="flex flex-col gap-2">
        <h3 id={`${id}-sem-par`} className="text-xs font-medium text-muted-foreground">Se não encontrar</h3>
        <div role="radiogroup" aria-labelledby={`${id}-sem-par`} className="grid grid-cols-2 gap-0.5 rounded-md border border-input bg-background p-0.5">
          {SE_NAO_ENCONTRAR.map(o => (
            <button key={o.valor} type="button" role="radio" aria-checked={o.valor === seNaoEncontrar} onClick={() => setConfig('seNaoEncontrar', o.valor)}
                    className={cn('h-7 rounded px-2 text-xs font-medium transition-colors',
                      o.valor === seNaoEncontrar ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {o.rotulo}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function DocumentacaoLookup() {
  return (
    <>
      <p>Para cada envelope da entrada <code>input</code>, procura na entrada <code>lookup</code> o envelope com a mesma chave e grava o <code>DATA</code> dele inteiro na chave de saída deste nó (padrão <code>$lookup</code>). Ex.: o código da empresa no sistema de origem → a empresa no destino.</p>
      <h4>Entradas</h4>
      <p><code>input</code> (em cima): os envelopes que vão ganhar o envelope achado. <code>lookup</code> (embaixo): a tabela onde procurar.</p>
      <p>O <code>lookup</code> é lido inteiro antes de o primeiro envelope sair e fica em memória; serve para tabelas de apoio (empresas, setores, de-para), não para milhões de linhas.</p>
      <h4>Saída</h4>
      <p>Os envelopes do <code>input</code>, com o envelope achado na chave de saída. Para escolher campos ou dar um valor padrão, ponha um Mapper depois: <code>{'$empresa?.id'}</code> → <code>empresaId</code>, <code>{'$empresa?.nome ?? "(sem empresa)"'}</code> → <code>nomeDaEmpresa</code>.</p>
      <h4>Comparação</h4>
      <p>Uma expression de cada lado: a da esquerda é avaliada no envelope do <code>input</code>, a da direita no do <code>lookup</code>. Ex.: <code>$codigoEmpresa</code> = <code>$codigo</code>. Com mais de uma linha, todas precisam bater. Os valores são comparados como texto: <code>1</code> acha <code>"1"</code>.</p>
      <p>Se o <code>lookup</code> tiver a mesma chave mais de uma vez, vale o primeiro envelope (e sai um aviso no log).</p>
      <h4>Se não encontrar</h4>
      <p><b>Gravar null</b>: a chave de saída fica <code>null</code> e o envelope segue. <b>Erro</b>: é erro do envelope e segue a política "Em caso de erro" do card (com Desviar, sai pela porta de erro).</p>
      <h4>Override</h4>
      <p>Ligado, o <code>DATA</code> de saída vira só o envelope achado (vazio se não achar).</p>
    </>
  )
}

export const LOOKUP: ComponenteDef = {
  tipo: lookup.tipo,
  rotulo: 'Lookup',
  descricao: 'Busca o envelope de outra entrada pela chave',
  categoria: 'transformacao',
  icone: SearchCheck,
  entradas: lookup.entradas,
  rotulosDasEntradas: ['input', 'lookup'],
  saidas: lookup.saidas,
  usaOverride: true,
  chaveDeSaidaPadrao: lookup.chaveDeSaidaPadrao,
  configPadrao: {chaves: [{principal: '', consulta: ''}], seNaoEncontrar: 'nulo'},
  Card: CardLookup,
  Painel: PainelLookup,
  Documentacao: DocumentacaoLookup,
  validar: config => lookup.validar(config),
}
