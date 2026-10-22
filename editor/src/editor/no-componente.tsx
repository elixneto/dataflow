import {Fragment, memo, useCallback, useEffect, type CSSProperties} from 'react'
import {
  Handle,
  Position,
  useNodeConnections,
  useReactFlow,
  useUpdateNodeInternals,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import {Minus, Plus, Power, StickyNote, TriangleAlert} from 'lucide-react'
import {CATEGORIAS, COR_DA_CATEGORIA, ehDoFluxo, FIM, INICIO, POR_TIPO} from '@/componentes/catalogo'
import type {Config} from '@/componentes/tipos'
import {TIPOS_DE_PORTA, type TipoDePorta} from '@dataflow/core'
import {cn} from '@/lib/utils'
import {useHistorico} from './historico'
import {useParametros} from './parametros-context'
import {useAvisos, useResultado} from './resultado-context'

export type DadosDoComponente = {
  tipo: string
  rotulo: string
  config: Config
  desativado?: boolean
  /** chave que o componente acrescenta no DATA */
  chaveDeSaida?: string
  /** a saída leva só a chave deste componente (descarta o resto do DATA) */
  override?: boolean
  /** anotação livre do usuário (aba Notes da janela) */
  notas?: string
}

export type NoComponente = Node<DadosDoComponente, 'componente'>

export const PORTA_DE_ERRO = 'erro'

export type PoliticaDeErro = 'parar' | 'continuar' | 'desviar'

const POLITICAS: {valor: PoliticaDeErro; rotulo: string; dica: string}[] = [
  {valor: 'parar', rotulo: 'Interromper', dica: 'Para todo o fluxo no primeiro erro'},
  {valor: 'continuar', rotulo: 'Continuar', dica: 'Com erro, o envelope que entrou sai sem mudança e o fluxo segue'},
  {valor: 'desviar', rotulo: 'Desviar', dica: 'Manda a linha com erro para a saída de erro'},
]

const ESPACO_ENTRE_PORTAS = 40

export function politicaDeErro(dados: DadosDoComponente): PoliticaDeErro {
  const v = dados.config.seErro
  return v === 'continuar' || v === 'desviar' ? v : 'parar'
}

// Início tem sempre 1 saída e Fim sempre 1 entrada (vêm do catálogo, como os outros componentes)
/** Tipo de cada entrada do nó. Início com "recebe entrada": uma porta que aceita qualquer corpo de fora (webhook), sem ligação. */
export function tiposDasEntradas(dados: DadosDoComponente): TipoDePorta[] {
  if (dados.tipo === INICIO) return dados.config.recebeEntrada === true ? ['qualquer'] : []
  const def = POR_TIPO[dados.tipo]
  if (def?.entradasVariaveis) return Array(qtdVariavel(dados, def.entradasVariaveis)).fill(def.entradas[0] ?? 'envelope')
  return def?.entradas ?? []
}

/** Quantidade de portas de um componente com portas variáveis (ex.: Union, Copy), dentro do mínimo e do máximo. */
function qtdVariavel(dados: DadosDoComponente, limites: {min: number; max: number; chave: string}) {
  const n = Math.round(Number(dados.config[limites.chave] ?? limites.min))
  return Math.min(limites.max, Math.max(limites.min, Number.isFinite(n) ? n : limites.min))
}

export function tiposDasSaidas(dados: DadosDoComponente): TipoDePorta[] {
  const def = POR_TIPO[dados.tipo]
  if (def?.saidasDaConfig) return def.saidasDaConfig(dados.config).map(() => 'envelope')
  if (def?.saidasVariaveis) return Array(qtdVariavel(dados, def.saidasVariaveis)).fill(def.saidas[0] ?? 'envelope')
  return def?.saidas ?? []
}

/** Nome da saída (out-N) mostrado ao lado da porta, se o componente dá nome às saídas. */
export function rotuloDaSaida(dados: DadosDoComponente, i: number): string | undefined {
  const def = POR_TIPO[dados.tipo]
  if (def?.saidasDaConfig) return def.saidasDaConfig(dados.config)[i]?.rotulo
  return def?.rotulosDasSaidas?.[i]
}

/** Saída que pode ficar sem ligação (o que sai por ela é descartado). */
export function saidaOpcional(dados: DadosDoComponente, porta: string): boolean {
  const opcionais = POR_TIPO[dados.tipo]?.saidasOpcionais ?? []
  return (typeof opcionais === 'function' ? opcionais(dados.config) : opcionais).includes(porta)
}

/** Tipo de uma porta pelo id (in-0, out-1, erro). A porta de erro leva os envelopes que falharam. */
export function tipoDaPorta(dados: DadosDoComponente, porta: string | null | undefined): TipoDePorta | undefined {
  if (!porta) return undefined
  if (porta === PORTA_DE_ERRO) return 'envelope'
  const [lado, n] = porta.split('-')
  return (lado === 'in' ? tiposDasEntradas(dados) : tiposDasSaidas(dados))[Number(n)]
}

export function qtdEntradas(dados: DadosDoComponente) {
  return tiposDasEntradas(dados).length
}

export function qtdSaidas(dados: DadosDoComponente) {
  return tiposDasSaidas(dados).length
}

/** Cor do bump de saída depois de executar: verde deu certo, vermelho deu erro, laranja seguiu com erro/aviso, cinza desativado. */
function corDoResultado(status: string | undefined, politica: PoliticaDeErro, envelopesQueSairam: number) {
  if (!status || status === 'nao-executou') return undefined
  // nenhum envelope saiu por esta porta (ex.: tudo foi desviado para o erro): cinza, o fluxo não passou por aqui
  if (status === 'concluido') return envelopesQueSairam > 0 ? 'sucesso' : 'desativado'
  if (status === 'desativado') return 'desativado'
  if (status === 'com-avisos') return 'continuou'
  if (status === 'com-erros' && politica === 'continuar') return 'continuou'
  return 'erro'
}

function posicaoDaPorta(i: number, total: number) {
  return `${((i + 1) / (total + 1)) * 100}%`
}

const RAIO_DA_ENTRADA = 16

/** Máscara que "come" um semicírculo da borda esquerda do card em cada entrada (o canvas aparece pelo furo). */
function mascaraDasEntradas(total: number): CSSProperties {
  if (total === 0) return {}
  const furos = Array.from({length: total}, (_, i) =>
    `radial-gradient(circle ${RAIO_DA_ENTRADA}px at -1px ${posicaoDaPorta(i, total)}, transparent ${RAIO_DA_ENTRADA - 0.5}px, #000 ${RAIO_DA_ENTRADA}px)`)
  const imagem = furos.join(', ')
  return {
    maskImage: imagem,
    WebkitMaskImage: imagem,
    maskComposite: 'intersect',
    WebkitMaskComposite: 'source-in',
  } as CSSProperties
}

function NoComponenteView({id, data, selected}: NodeProps<NoComponente>) {
  const {updateNodeData, getNode, setEdges} = useReactFlow<NoComponente, Edge>()
  const atualizarPortas = useUpdateNodeInternals()
  const {registrar, registrarEdicao} = useHistorico()
  const parametros = useParametros()
  const resultado = useResultado()[id]
  const avisos = useAvisos()[id]
  const chegando = useNodeConnections({handleType: 'target'})
  const saindo = useNodeConnections({handleType: 'source'})
  const def = POR_TIPO[data.tipo]
  const entradas = qtdEntradas(data)
  const saidas = qtdSaidas(data)
  const doFluxo = ehDoFluxo(data.tipo)
  const politica = politicaDeErro(data)
  const temPoliticaDeErro = !doFluxo && !POR_TIPO[data.tipo]?.semErro
  const comPortaDeErro = temPoliticaDeErro && politica === 'desviar'

  useEffect(() => {
    atualizarPortas(id)
  }, [id, entradas, saidas, comPortaDeErro, atualizarPortas])

  const setConfig = useCallback((chave: string, valor: unknown) => {
    registrarEdicao(`${id}:${chave}`)
    updateNodeData(id, no => ({config: {...no.data.config, [chave]: valor}}))
  }, [id, updateNodeData, registrarEdicao])

  if (!def) return null

  const recebeLinhas = chegando.some(c => getNode(c.source)?.data.tipo !== INICIO)

  function trocarPolitica(proxima: PoliticaDeErro) {
    if (proxima === politica) return
    registrar()
    if (proxima !== 'desviar') {
      setEdges(atual => atual.filter(e => !(e.source === id && e.sourceHandle === PORTA_DE_ERRO)))
    }
    updateNodeData(id, no => ({config: {...no.data.config, seErro: proxima}}))
  }

  /** −/+ das entradas variáveis: tirar uma porta apaga a ligação que chegava nela. */
  function mudarEntradas(delta: number) {
    const limites = def.entradasVariaveis
    if (!limites) return
    const proximo = Math.min(limites.max, Math.max(limites.min, entradas + delta))
    if (proximo === entradas) return
    registrar()
    if (proximo < entradas) {
      const removida = `in-${entradas - 1}`
      setEdges(lista => lista.filter(e => !(e.target === id && e.targetHandle === removida)))
    }
    updateNodeData(id, no => ({config: {...no.data.config, [limites.chave]: proximo}}))
  }

  /** −/+ das saídas variáveis: tirar uma porta apaga a ligação que saía dela. */
  function mudarSaidas(delta: number) {
    const limites = def.saidasVariaveis
    if (!limites) return
    const proximo = Math.min(limites.max, Math.max(limites.min, saidas + delta))
    if (proximo === saidas) return
    registrar()
    if (proximo < saidas) {
      const removida = `out-${saidas - 1}`
      setEdges(lista => lista.filter(e => !(e.source === id && e.sourceHandle === removida)))
    }
    updateNodeData(id, no => ({config: {...no.data.config, [limites.chave]: proximo}}))
  }

  function alternarDesativado() {
    registrar()
    updateNodeData(id, {desativado: !data.desativado})
  }

  // com entrada, as linhas divisórias começam depois do furo (senão atravessam o encaixe "comido")
  const recuo = entradas > 0 ? 'ml-4 pl-1' : 'pl-5'
  const cat = CATEGORIAS[def.categoria]
  const Icone = def.icone
  const Card = def.Card
  const maiorQtdDePortas = Math.max(entradas, saidas)
  const estilo = {
    '--port-border': selected ? COR_DA_CATEGORIA[def.categoria] : 'color-mix(in oklch, var(--muted-foreground) 45%, transparent)',
    '--port-accent': COR_DA_CATEGORIA[def.categoria],
    minHeight: maiorQtdDePortas > 1 ? (maiorQtdDePortas + 1) * ESPACO_ENTRE_PORTAS : undefined,
  } as CSSProperties

  return (
    <div
      className={cn(
        'snap-card relative isolate text-card-foreground transition-opacity',
        doFluxo ? 'w-44' : 'w-72',
        data.desativado && 'opacity-45',
      )}
      style={estilo}
    >
      {/* fundo e borda num elemento à parte: a máscara que abre os furos das entradas não pode cortar as portas */}
      <div aria-hidden="true" style={mascaraDasEntradas(entradas)}
           className={cn('snap-card-fundo pointer-events-none absolute inset-0 -z-10 rounded-xl border-[var(--port-border)] bg-node', selected ? 'border-[2.5px]' : 'border')}/>
      {Array.from({length: entradas}).map((_, i) => {
        const porta = `in-${i}`
        const ligada = chegando.some(c => c.targetHandle === porta)
        const nome = def.rotulosDasEntradas?.[i]
        return (
          <Fragment key={porta}>
          {/* nome da entrada do lado de fora, logo acima da ligação */}
          {nome && (
            <span aria-hidden="true" style={{top: posicaoDaPorta(i, entradas)}}
                  className="pointer-events-none absolute right-[calc(100%+14px)] -translate-y-[calc(100%+3px)] font-mono text-xs text-muted-foreground">
              {nome}
            </span>
          )}
          <Handle id={porta} type="target" position={Position.Left} style={{top: posicaoDaPorta(i, entradas)}}
                  isConnectable={data.tipo !== INICIO}
                  data-tipo={tiposDasEntradas(data)[i]}
                  title={`Entrada: ${TIPOS_DE_PORTA[tiposDasEntradas(data)[i]]}`}
                  className={cn('snap-port snap-port-in', ligada && 'is-connected', def.entradasOpcionais && 'is-optional', data.tipo === FIM && 'is-multipla')}
                  aria-label={data.tipo === INICIO ? 'Entrada do workflow' : nome ? `Entrada ${nome}` : def.entradasOpcionais ? `Entrada ${i + 1} (opcional)` : `Entrada ${i + 1}`}>
            {/* no Início a porta é só o encaixe, sem a bolinha: não aceita ligação */}
            {data.tipo !== INICIO && <span className="snap-port-dot" aria-hidden="true"/>}
          </Handle>
          </Fragment>
        )
      })}

      <header className="flex items-center gap-2 py-2.5 pl-5 pr-3">
        <Icone className={cn('size-3.5 shrink-0', cat.corTexto)} aria-hidden="true"/>
        <span className={cn('min-w-0 flex-1 truncate text-sm font-semibold', data.desativado && 'line-through')}>{data.rotulo}</span>
        {avisos?.length ? (
          <span title={[...new Set(avisos)].join('\n')} className="flex shrink-0 text-destructive" aria-label="Com erro">
            <TriangleAlert className="size-4" aria-hidden="true"/>
          </span>
        ) : null}
        {data.notas?.trim() && (
          <span title={data.notas} className="flex shrink-0 text-comentario" aria-label="Tem anotação">
            <StickyNote className="size-3.5" aria-hidden="true"/>
          </span>
        )}
        {!doFluxo && (
          <button type="button" onClick={alternarDesativado}
                  className={cn('nodrag flex size-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-accent',
                    data.desativado ? 'text-destructive' : 'text-muted-foreground hover:text-foreground')}
                  aria-label={data.desativado ? 'Ativar componente' : 'Desativar componente'} aria-pressed={data.desativado ?? false}
                  title={data.desativado ? 'Ativar' : 'Desativar'}>
            <Power className="size-3" aria-hidden="true"/>
          </button>
        )}
      </header>

      {data.tipo === INICIO && (
        <div className={cn('flex items-center justify-between gap-2 border-t border-border py-2 pr-3', recuo)}
             title={parametros.length ? parametros.map(p => `$PARAMETERS.${p.nome || '?'} = ${p.padrao || '""'}`).join('\n') : 'Duplo clique para criar parâmetros'}>
          <span className="text-xs font-medium text-muted-foreground">Parâmetros</span>
          <span className={cn('rounded-full px-2 font-mono text-xs', parametros.length ? 'bg-flow/15 text-foreground' : 'text-muted-foreground')}>{parametros.length}</span>
        </div>
      )}

      {def.entradasVariaveis && (
        <ContadorDePortas rotulo="Entradas" qtd={entradas} limites={def.entradasVariaveis} onMudar={mudarEntradas} className={recuo}/>
      )}
      {def.saidasVariaveis && (
        <ContadorDePortas rotulo="Saídas" qtd={saidas} limites={def.saidasVariaveis} onMudar={mudarSaidas} className={recuo}/>
      )}

      {!doFluxo && Card && (
        <div className={cn('border-t border-border py-3 pr-5', recuo)}>
          <Card id={id} noId={id} config={data.config} setConfig={setConfig} recebeLinhas={recebeLinhas}/>
        </div>
      )}

      {temPoliticaDeErro && (
        <div className={cn('flex flex-col gap-1.5 border-t border-border pr-5 pt-2.5', recuo, comPortaDeErro ? 'pb-5' : 'pb-3')}>
          <span id={`${id}-se-erro`} className="text-xs font-medium text-muted-foreground">Em caso de erro</span>
          <div role="radiogroup" aria-labelledby={`${id}-se-erro`}
               className="nodrag grid grid-cols-3 gap-0.5 rounded-md border border-input bg-background p-0.5">
            {POLITICAS.map(p => {
              const ativa = p.valor === politica
              return (
                <button key={p.valor} type="button" role="radio" aria-checked={ativa} title={p.dica} onClick={() => trocarPolitica(p.valor)}
                        className={cn('h-6 rounded px-1 text-xs font-medium transition-colors',
                          ativa ? (p.valor === 'desviar' ? 'bg-destructive/20 text-destructive' : 'bg-accent text-foreground')
                            : 'text-muted-foreground hover:text-foreground')}>
                  {p.rotulo}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {comPortaDeErro && (
        <Handle id={PORTA_DE_ERRO} type="source" position={Position.Bottom}
                className={cn('snap-port snap-port-error', saindo.some(c => c.sourceHandle === PORTA_DE_ERRO) && 'is-connected')}
                data-resultado={resultado?.saidas[PORTA_DE_ERRO] ? 'erro' : undefined}
                data-tipo="envelope" aria-label="Saída de erro" title="Saída de erro: Envelopes que falharam">
          <span className="snap-port-dot" aria-hidden="true"/>
        </Handle>
      )}

      {Array.from({length: saidas}).map((_, i) => {
        const porta = `out-${i}`
        const ligada = saindo.some(c => c.sourceHandle === porta)
        const nome = rotuloDaSaida(data, i)
        return (
          <Fragment key={porta}>
            <Handle id={porta} type="source" position={Position.Right} style={{top: posicaoDaPorta(i, saidas)}}
                    data-tipo={tiposDasSaidas(data)[i]} data-resultado={corDoResultado(resultado?.status, politica, resultado?.saidas[porta] ?? 0)}
                    title={`Saída${nome ? ` ${nome}` : ''}: ${TIPOS_DE_PORTA[tiposDasSaidas(data)[i]]}`}
                    className={cn('snap-port snap-port-out', ligada && 'is-connected', saidaOpcional(data, porta) && 'is-optional')} aria-label={nome ? `Saída ${nome}` : `Saída ${i + 1}`}>
              <span className="snap-port-dot" aria-hidden="true"/>
            </Handle>
            {/* nome da saída do lado de fora, logo acima da ligação */}
            {nome && (
              <span aria-hidden="true" style={{top: posicaoDaPorta(i, saidas)}}
                    className="pointer-events-none absolute left-[calc(100%+14px)] -translate-y-[calc(100%+3px)] font-mono text-xs text-muted-foreground">
                {nome}
              </span>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}

export const NoComponenteMemo = memo(NoComponenteView)

/** −/+ de um componente com portas variáveis (entradas do Union, saídas do Copy). */
function ContadorDePortas({rotulo, qtd, limites, onMudar, className}: {
  rotulo: string
  qtd: number
  limites: {min: number; max: number}
  onMudar: (delta: number) => void
  className: string
}) {
  const singular = rotulo === 'Saídas' ? 'saída' : 'entrada'
  return (
    <div className={cn('flex items-center justify-between gap-2 border-t border-border py-2 pr-3', className)}>
      <span className="text-xs font-medium text-muted-foreground">{rotulo}</span>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onMudar(-1)} disabled={qtd <= limites.min}
                className="nodrag flex size-5 items-center justify-center rounded border border-input text-muted-foreground hover:text-foreground disabled:opacity-40"
                aria-label={`Remover ${singular}`}>
          <Minus className="size-3" aria-hidden="true"/>
        </button>
        <span className="w-7 text-center font-mono text-xs" aria-live="polite">{qtd}</span>
        <button type="button" onClick={() => onMudar(1)} disabled={qtd >= limites.max}
                className="nodrag flex size-5 items-center justify-center rounded border border-input text-muted-foreground hover:text-foreground disabled:opacity-40"
                aria-label={`Adicionar ${singular}`}>
          <Plus className="size-3" aria-hidden="true"/>
        </button>
      </div>
    </div>
  )
}
