import {useCallback, useEffect, useMemo, useRef, useState, type DragEvent} from 'react'
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
  type XYPosition,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {CircleAlert, Play, X} from 'lucide-react'
import {CATEGORIAS, COR_DA_CATEGORIA, DRAG_MIME, ehDoFluxo, FIM, INICIO, POR_TIPO} from '@/componentes/catalogo'
import {cn} from '@/lib/utils'
import type {Fluxo, NoDoFluxo} from '@/mock/fluxos'
import {obterProjeto, PROJETO_DE_EXEMPLOS} from '@/mock/projetos'
import {portasCompativeis, type ModoDeExecucao, type ParametroDoWorkflow, type RegistroDaExecucao} from '@dataflow/core'
import {PainelDaExecucao} from '@/execucao/painel-da-execucao'
import {cancelarNoRunner, executarNoRunner, paraExecutar} from '@/execucao/runner'
import {Barra, type ResultadoDaValidacao} from './barra'
import {HistoricoContext} from './historico'
import {NoComentarioMemo, TAMANHO_DO_COMENTARIO, type NoComentario} from './no-comentario'
import {CORES_DO_GRUPO, NoGrupoMemo, TAMANHO_DO_GRUPO, Z_DO_GRUPO, type NoGrupo} from './no-grupo'
import {NoComponenteMemo, PORTA_DE_ERRO, qtdSaidas, rotuloDaSaida, tipoDaPorta, type NoComponente} from './no-componente'
import {Paleta} from './paleta'
import {organizarHorizontal} from './layout'
import {Janela, type PosicaoDaJanela, type TamanhoDaJanela} from './janela'
import {PainelDoWorkflow} from './painel-do-workflow'
import {ParametrosContext} from './parametros-context'
import {AvisosContext, ResultadoContext} from './resultado-context'
import {PainelPropriedades} from './painel-propriedades'
import {ResizeObserverGuard} from './resize-observer-guard'
import {ehComponente, recebeLinhas, validarFluxo, type Pendencia} from './validacao'

type Retrato = {nodes: NoDoFluxo[]; edges: Edge[]}

const nodeTypes = {componente: NoComponenteMemo, comentario: NoComentarioMemo, grupo: NoGrupoMemo}

const LIMITE_DO_HISTORICO = 100
const JANELA_DE_EDICAO_MS = 1000
const DESLOCAMENTO_AO_COLAR = 40
const TEMPO_DE_VALIDACAO_MS = 900

let contador = 0
function novoId(tipo: string) {
  contador += 1
  return `${tipo}-${Date.now().toString(36)}${contador}`
}

function ehCampoEditavel(alvo: EventTarget | null) {
  if (!(alvo instanceof HTMLElement)) return false
  return alvo.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName)
}

function ehDoFluxoNo(no: NoDoFluxo) {
  return ehComponente(no) && ehDoFluxo(no.data.tipo)
}

type Props = {
  fluxo: Fluxo
  onSalvar: (fluxo: Fluxo) => Fluxo
}

function Editor({fluxo, onSalvar}: Props) {
  const wrapperRef = useRef<HTMLElement>(null)
  const {screenToFlowPosition, getNodes, getEdges, fitView} = useReactFlow<NoDoFluxo, Edge>()
  const [nodes, setNodes, onNodesChange] = useNodesState<NoDoFluxo>(fluxo.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(fluxo.edges)
  const [nome, setNome] = useState(fluxo.nome)
  const [base, setBase] = useState(fluxo)
  const [alterado, setAlterado] = useState(false)
  const [validacao, setValidacao] = useState<ResultadoDaValidacao>(null)
  const [pendencias, setPendencias] = useState<Pendencia[]>([])
  const [verPendencias, setVerPendencias] = useState(false)
  const [validando, setValidando] = useState(false)
  const [parametros, setParametros] = useState<ParametroDoWorkflow[]>(fluxo.parametros ?? [])
  const [execucao, setExecucao] = useState<RegistroDaExecucao | null>(null)
  const [rodando, setRodando] = useState<ModoDeExecucao | null>(null)
  const idDaExecucao = useRef<string | null>(null)
  // o bump de saída de cada componente pinta conforme o resultado (some ao fechar o resultado)
  const statusDaUltimaExecucao = useMemo(
    () => Object.fromEntries((execucao?.componentes ?? []).map(c => [c.noId, c])),
    [execucao],
  )
  const avisos = useMemo(() => {
    const porNo: Record<string, string[]> = {}
    const juntar = (id: string, msg: string) => (porNo[id] ??= []).push(msg)
    for (const p of pendencias) juntar(p.noId, p.mensagem)
    for (const c of execucao?.componentes ?? []) {
      if (c.status !== 'falhou' && c.status !== 'com-erros') continue
      const erros = c.logs.filter(l => l.nivel === 'erro').map(l => l.mensagem)
      for (const m of erros.length ? erros.slice(0, 5) : ['Deu erro na execução.']) juntar(c.noId, m)
    }
    return porNo
  }, [pendencias, execucao])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  // o fitView do <ReactFlow> roda antes dos cards (altos) serem medidos; enquadra de novo quando já têm tamanho
  const nosMedidos = useNodesInitialized()
  const enquadrado = useRef(false)
  useEffect(() => {
    if (!nosMedidos || enquadrado.current) return
    enquadrado.current = true
    requestAnimationFrame(() => fitView({padding: 0.12, maxZoom: 1}))
  }, [nosMedidos, fitView])

  // avisa antes de sair com alteração não salva
  useEffect(() => {
    if (!alterado) return
    const aviso = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', aviso)
    return () => window.removeEventListener('beforeunload', aviso)
  }, [alterado])

  const invalidos = useMemo(() => new Set(pendencias.map(p => p.noId)), [pendencias])

  // O destaque vermelho é só visual, mas o updateNodeData do card devolve o nó já com o className para o estado.
  // Por isso o className é sempre recalculado aqui (põe ou tira), em vez de só acrescentar nos inválidos.
  const nosNaTela = useMemo(
    () => nodes.map(n => {
      const classe = invalidos.has(n.id) ? 'is-invalid' : undefined
      return n.className === classe ? n : {...n, className: classe}
    }),
    [nodes, invalidos],
  )
  const ligacoesNaTela = useMemo(
    () => edges.map(e => {
      const deErro = e.sourceHandle === PORTA_DE_ERRO
      if (!deErro && !validando) return e
      return {...e, ...(validando && {animated: true}), ...(deErro && {className: 'is-error-edge'})}
    }),
    [edges, validando],
  )

  // ---------- histórico (Ctrl+Z / Ctrl+Shift+Z) ----------

  const passado = useRef<Retrato[]>([])
  const futuro = useRef<Retrato[]>([])
  const ultimaEdicao = useRef<{chave: string; em: number} | null>(null)
  const [tamanhoDoHistorico, setTamanhoDoHistorico] = useState({passado: 0, futuro: 0})

  const sincronizar = useCallback(() => setTamanhoDoHistorico({passado: passado.current.length, futuro: futuro.current.length}), [])

  const invalidarValidacao = useCallback(() => {
    setValidacao(null)
    setPendencias([])
  }, [])

  const registrar = useCallback(() => {
    passado.current = [...passado.current.slice(-(LIMITE_DO_HISTORICO - 1)), {nodes: getNodes(), edges: getEdges()}]
    futuro.current = []
    ultimaEdicao.current = null
    setAlterado(true)
    invalidarValidacao()
    sincronizar()
  }, [getNodes, getEdges, sincronizar, invalidarValidacao])

  const registrarEdicao = useCallback((chave: string) => {
    const agora = Date.now()
    const anterior = ultimaEdicao.current
    setAlterado(true)
    if (anterior && anterior.chave === chave && agora - anterior.em < JANELA_DE_EDICAO_MS) {
      ultimaEdicao.current = {chave, em: agora}
      return
    }
    registrar()
    ultimaEdicao.current = {chave, em: agora}
  }, [registrar])

  const desfazer = useCallback(() => {
    const anterior = passado.current.at(-1)
    if (!anterior) return
    passado.current = passado.current.slice(0, -1)
    futuro.current = [...futuro.current, {nodes: getNodes(), edges: getEdges()}]
    ultimaEdicao.current = null
    setNodes(anterior.nodes)
    setEdges(anterior.edges)
    setAlterado(true)
    invalidarValidacao()
    sincronizar()
  }, [getNodes, getEdges, setNodes, setEdges, sincronizar, invalidarValidacao])

  const refazer = useCallback(() => {
    const proximo = futuro.current.at(-1)
    if (!proximo) return
    futuro.current = futuro.current.slice(0, -1)
    passado.current = [...passado.current, {nodes: getNodes(), edges: getEdges()}]
    ultimaEdicao.current = null
    setNodes(proximo.nodes)
    setEdges(proximo.edges)
    setAlterado(true)
    invalidarValidacao()
    sincronizar()
  }, [getNodes, getEdges, setNodes, setEdges, sincronizar, invalidarValidacao])

  // ---------- copiar / colar ----------

  const area = useRef<{nodes: NoDoFluxo[]; edges: Edge[]; colagens: number} | null>(null)

  const copiar = useCallback(() => {
    const selecionados = getNodes().filter(n => n.selected && !ehDoFluxoNo(n))
    if (selecionados.length === 0) return false
    const ids = new Set(selecionados.map(n => n.id))
    area.current = {
      nodes: structuredClone(selecionados),
      edges: structuredClone(getEdges().filter(e => ids.has(e.source) && ids.has(e.target))),
      colagens: 0,
    }
    return true
  }, [getNodes, getEdges])

  const colar = useCallback(() => {
    const copiado = area.current
    if (!copiado || copiado.nodes.length === 0) return
    copiado.colagens += 1
    const deslocamento = DESLOCAMENTO_AO_COLAR * copiado.colagens
    const ids = new Map<string, string>()
    const novos = copiado.nodes.map(n => {
      const id = novoId(ehComponente(n) ? n.data.tipo : n.type ?? 'no')
      ids.set(n.id, id)
      return {...structuredClone(n), id, selected: true, dragging: false, position: {x: n.position.x + deslocamento, y: n.position.y + deslocamento}} as NoDoFluxo
    })
    const novasLigacoes = copiado.edges.map(e => ({
      ...structuredClone(e), id: novoId('edge'), source: ids.get(e.source)!, target: ids.get(e.target)!, selected: false,
    }))
    registrar()
    setNodes(atual => [...atual.map(n => ({...n, selected: false})), ...novos])
    setEdges(atual => [...atual.map(e => ({...e, selected: false})), ...novasLigacoes])
  }, [registrar, setNodes, setEdges])

  // ---------- salvar ----------

  const salvar = useCallback(() => {
    const salvo = onSalvar({...base, nome, parametros, nodes: getNodes().map(n => ({...n, selected: false, className: undefined})), edges: getEdges()})
    setBase(salvo)
    setAlterado(false)
  }, [base, nome, parametros, getNodes, getEdges, onSalvar])

  useEffect(() => {
    function aoTeclar(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return
      const tecla = event.key.toLowerCase()
      if (tecla === 's') {
        event.preventDefault()
        salvar()
        return
      }
      if (ehCampoEditavel(event.target)) return
      if (tecla === 'c') {
        if (copiar()) event.preventDefault()
      } else if (tecla === 'x') {
        if (!copiar()) return
        event.preventDefault()
        const ids = new Set(getNodes().filter(n => n.selected && !ehDoFluxoNo(n)).map(n => n.id))
        registrar()
        setNodes(atual => atual.filter(n => !ids.has(n.id)))
        setEdges(atual => atual.filter(e => !ids.has(e.source) && !ids.has(e.target)))
        if (area.current) area.current.colagens = -1
      } else if (tecla === 'v') {
        if (!area.current) return
        event.preventDefault()
        colar()
      } else if (tecla === 'z' && !event.shiftKey) {
        event.preventDefault()
        desfazer()
      } else if ((tecla === 'z' && event.shiftKey) || tecla === 'y') {
        event.preventDefault()
        refazer()
      }
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [desfazer, refazer, copiar, colar, salvar, getNodes, registrar, setNodes, setEdges])

  const historico = useMemo(() => ({registrar, registrarEdicao}), [registrar, registrarEdicao])

  // ---------- janelas de configuração (duplo clique; uma por componente, várias abertas) ----------

  const [janelas, setJanelas] = useState<{id: string; posicao: PosicaoDaJanela; tamanho?: TamanhoDaJanela}[]>([])

  // posição e tamanho de cada janela ficam lembrados neste navegador (por fluxo e componente), fora do fluxo e do Ctrl+Z
  const chaveDaJanela = useCallback((noId: string) => `dataflow-fluxos-janela:${fluxo.id}:${noId}`, [fluxo.id])
  const lerJanela = useCallback((noId: string): {posicao?: PosicaoDaJanela; tamanho?: TamanhoDaJanela} => {
    try {
      return JSON.parse(localStorage.getItem(chaveDaJanela(noId)) ?? '{}')
    } catch {
      return {}
    }
  }, [chaveDaJanela])
  const lembrarJanela = useCallback((noId: string, mudanca: {posicao?: PosicaoDaJanela; tamanho?: TamanhoDaJanela}) => {
    try {
      localStorage.setItem(chaveDaJanela(noId), JSON.stringify({...lerJanela(noId), ...mudanca}))
    } catch {
      // sem storage: abre no lugar padrão da próxima vez
    }
  }, [chaveDaJanela, lerJanela])

  const abrirJanela = useCallback((id: string) => {
    const lembrada = lerJanela(id)
    setJanelas(atual => {
      const aberta = atual.find(j => j.id === id)
      if (aberta) return [...atual.filter(j => j.id !== id), aberta] // já aberta: só vem para a frente
      const n = atual.length % 8
      const no = getNodes().find(x => x.id === id)
      const padrao = no && ehComponente(no) ? POR_TIPO[no.data.tipo]?.tamanhoDaJanela : undefined
      return [...atual, {id, posicao: lembrada.posicao ?? {x: 24 + n * 28, y: 56 + n * 28}, tamanho: lembrada.tamanho ?? padrao}]
    })
  }, [lerJanela, getNodes])
  const fecharJanela = useCallback((id: string) => setJanelas(atual => atual.filter(j => j.id !== id)), [])
  const focarJanela = useCallback((id: string) => setJanelas(atual =>
    atual.at(-1)?.id === id ? atual : [...atual.filter(j => j.id !== id), atual.find(j => j.id === id)!]), [])
  const moverJanela = useCallback((id: string, posicao: PosicaoDaJanela) => {
    setJanelas(atual => atual.map(j => (j.id === id ? {...j, posicao} : j)))
    lembrarJanela(id, {posicao})
  }, [lembrarJanela])

  // componente apagado (Delete, Ctrl+X, desfazer...) fecha a janela dele
  useEffect(() => {
    setJanelas(atual => {
      const restantes = atual.filter(j => nodes.some(n => n.id === j.id))
      return restantes.length === atual.length ? atual : restantes
    })
  }, [nodes])

  // ---------- ligações ----------

  const aoLigar = useCallback((ligacao: Connection) => {
    registrar()
    setEdges(atual => addEdge(ligacao, atual))
  }, [setEdges, registrar])

  /** Cada porta aceita uma ligação só, e só de um tipo compatível (envelope com envelope, qualquer com tudo...). */
  const ligacaoValida: IsValidConnection = useCallback(ligacao => {
    if (ligacao.source === ligacao.target) return false
    const origem = nodes.find(n => n.id === ligacao.source)
    const destino = nodes.find(n => n.id === ligacao.target)
    if (!origem || !destino || !ehComponente(origem) || !ehComponente(destino)) return false
    const tipoDeSaida = tipoDaPorta(origem.data, ligacao.sourceHandle)
    const tipoDeEntrada = tipoDaPorta(destino.data, ligacao.targetHandle)
    if (!tipoDeSaida || !tipoDeEntrada || !portasCompativeis(tipoDeSaida, tipoDeEntrada)) return false
    // o End aceita várias ligações na mesma entrada (o motor junta, como o Union)
    const entradaOcupada = destino.data.tipo !== FIM && edges.some(e => e.target === ligacao.target && e.targetHandle === ligacao.targetHandle)
    const saidaOcupada = edges.some(e => e.source === ligacao.source && e.sourceHandle === ligacao.sourceHandle)
    return !entradaOcupada && !saidaOcupada
  }, [edges, nodes])

  // ---------- arrastar da paleta ----------

  function aoArrastarSobre(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }

  function novoNo(tipo: string, position: {x: number; y: number}): NoComponente | null {
    const def = POR_TIPO[tipo]
    if (!def) return null
    return {
      id: novoId(tipo), type: 'componente', position, selected: true,
      data: {tipo, rotulo: def.rotulo, config: structuredClone(def.configPadrao ?? {}), chaveDeSaida: def.chaveDeSaidaPadrao ? chaveLivre(def.chaveDeSaidaPadrao) : undefined},
    }
  }

  function aoSoltar(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    const no = novoNo(event.dataTransfer.getData(DRAG_MIME), screenToFlowPosition({x: event.clientX - 128, y: event.clientY - 30}))
    if (!no) return
    registrar()
    setNodes(atual => [...atual.map(n => ({...n, selected: false})), no])
  }

  /**
   * Duplo clique na paleta: põe o componente na prancheta. Com um componente selecionado, o novo vai à direita dele
   * e a primeira saída livre do selecionado liga na entrada do novo, se os tipos forem compatíveis.
   */
  function adicionarDaPaleta(tipo: string) {
    const atuais = getNodes()
    const selecionados = atuais.filter(n => n.selected)
    const anterior = selecionados.length === 1 && ehComponente(selecionados[0]) ? selecionados[0] : null
    const caixa = wrapperRef.current?.getBoundingClientRect()
    const centro = caixa ? screenToFlowPosition({x: caixa.left + caixa.width / 2 - 128, y: caixa.top + caixa.height / 2 - 60}) : {x: 0, y: 0}
    const posicao = anterior
      ? {x: anterior.position.x + (anterior.measured?.width ?? 288) + 80, y: anterior.position.y}
      : centro
    const no = novoNo(tipo, posicao)
    if (!no) return

    // liga só se a saída do selecionado ainda está livre e o tipo combina com a 1ª entrada do novo
    const tipoDaEntradaNova = tipoDaPorta(no.data, 'in-0')
    const ligacoesAtuais = getEdges()
    const saidaLivre = anterior && tipoDaEntradaNova
      ? Array.from({length: qtdSaidas(anterior.data)}, (_, i) => `out-${i}`).find(porta => {
          const tipoDaSaida = tipoDaPorta(anterior.data, porta)
          return tipoDaSaida && portasCompativeis(tipoDaSaida, tipoDaEntradaNova)
            && !ligacoesAtuais.some(e => e.source === anterior.id && e.sourceHandle === porta)
        })
      : undefined

    registrar()
    setNodes(lista => [...lista.map(n => ({...n, selected: false})), no])
    if (anterior && saidaLivre) {
      setEdges(lista => addEdge({source: anterior.id, sourceHandle: saidaLivre, target: no.id, targetHandle: 'in-0'}, lista))
    }
  }

  /** Primeiro nome livre para a chave no DATA: mapper, mapper2, mapper3... */
  function chaveLivre(base: string) {
    const usadas = new Set(getNodes().filter(ehComponente).map(n => n.data.chaveDeSaida))
    let nome = base
    for (let i = 2; usadas.has(nome); i++) nome = `${base}${i}`
    return nome
  }

  function adicionarComentario() {
    const caixa = wrapperRef.current?.getBoundingClientRect()
    const centro = caixa ? screenToFlowPosition({x: caixa.left + caixa.width / 2, y: caixa.top + caixa.height / 2}) : {x: 0, y: 0}
    registrar()
    const comentario: NoComentario = {
      id: novoId('comentario'), type: 'comentario', selected: true, ...TAMANHO_DO_COMENTARIO,
      position: {x: centro.x - TAMANHO_DO_COMENTARIO.width / 2, y: centro.y - TAMANHO_DO_COMENTARIO.height / 2},
      data: {titulo: '', texto: '', recolhido: false},
    }
    setNodes(atual => [comentario, ...atual.map(n => ({...n, selected: false}))])
  }

  function adicionarGrupo() {
    const caixa = wrapperRef.current?.getBoundingClientRect()
    const centro = caixa ? screenToFlowPosition({x: caixa.left + caixa.width / 2, y: caixa.top + caixa.height / 2}) : {x: 0, y: 0}
    registrar()
    const usadas = getNodes().filter(n => n.type === 'grupo').length
    const grupo: NoGrupo = {
      id: novoId('grupo'), type: 'grupo', selected: true, zIndex: Z_DO_GRUPO, ...TAMANHO_DO_GRUPO,
      position: {x: centro.x - TAMANHO_DO_GRUPO.width / 2, y: centro.y - TAMANHO_DO_GRUPO.height / 2},
      data: {titulo: '', cor: CORES_DO_GRUPO[usadas % CORES_DO_GRUPO.length]},
    }
    setNodes(atual => [grupo, ...atual.map(n => ({...n, selected: false}))])
  }

  /** Arrastar um grupo leva junto o que está inteiro dentro dele (posições do início do arraste). */
  const arrasteDoGrupo = useRef<{id: string; inicio: XYPosition; dentro: Map<string, XYPosition>} | null>(null)

  function comecarArraste(_: unknown, no: NoDoFluxo) {
    registrar()
    arrasteDoGrupo.current = null
    if (no.type !== 'grupo') return
    const largura = no.measured?.width ?? no.width ?? 0
    const altura = no.measured?.height ?? no.height ?? 0
    const dentro = new Map<string, XYPosition>()
    for (const n of getNodes()) {
      if (n.id === no.id || n.selected) continue
      const w = n.measured?.width ?? 0
      const h = n.measured?.height ?? 0
      if (n.position.x >= no.position.x && n.position.y >= no.position.y
        && n.position.x + w <= no.position.x + largura && n.position.y + h <= no.position.y + altura) dentro.set(n.id, n.position)
    }
    arrasteDoGrupo.current = {id: no.id, inicio: no.position, dentro}
  }

  function arrastar(_: unknown, no: NoDoFluxo) {
    const arraste = arrasteDoGrupo.current
    if (!arraste || arraste.id !== no.id || arraste.dentro.size === 0) return
    const dx = no.position.x - arraste.inicio.x
    const dy = no.position.y - arraste.inicio.y
    setNodes(atual => atual.map(n => {
      const p = arraste.dentro.get(n.id)
      return p ? {...n, position: {x: p.x + dx, y: p.y + dy}} : n
    }))
  }

  // ---------- painel ----------

  /** Nome da porta para as métricas: o rótulo da saída (SP, false...) ou o id dela (out-1, in-0, erro). */
  const nomeDaPorta = useCallback((noId: string, porta: string) => {
    const [lado, n] = porta.split('-')
    const no = nodes.find(x => x.id === noId)
    if (lado === 'out' && no && ehComponente(no)) return rotuloDaSaida(no.data, Number(n)) ?? porta
    return porta
  }, [nodes])

  const mudarRotulo = useCallback((id: string, rotulo: string) => {
    registrarEdicao(`${id}:rotulo`)
    setNodes(atual => atual.map(n => (n.id === id && ehComponente(n) ? {...n, data: {...n.data, rotulo}} : n)))
  }, [setNodes, registrarEdicao])

  const mudarDados = useCallback((id: string, mudanca: Partial<Pick<NoComponente['data'], 'chaveDeSaida' | 'override' | 'notas'>>) => {
    registrarEdicao(`${id}:${Object.keys(mudanca).join(',')}`)
    setNodes(atual => atual.map(n => (n.id === id && ehComponente(n) ? {...n, data: {...n.data, ...mudanca}} : n)))
  }, [setNodes, registrarEdicao])

  const mudarConfig = useCallback((id: string, chave: string, valor: unknown) => {
    registrarEdicao(`${id}:${chave}`)
    setNodes(atual => atual.map(n => (n.id === id && ehComponente(n) ? {...n, data: {...n.data, config: {...n.data.config, [chave]: valor}}} : n)))
  }, [setNodes, registrarEdicao])

  const excluir = useCallback((id: string) => {
    registrar()
    setNodes(atual => atual.filter(n => n.id !== id))
    setEdges(atual => atual.filter(e => e.source !== id && e.target !== id))
  }, [setNodes, setEdges, registrar])

  function irPara(noId: string) {
    setNodes(atual => atual.map(n => ({...n, selected: n.id === noId})))
    fitView({nodes: [{id: noId}], duration: 400, maxZoom: 1.1, padding: 0.6})
  }

  // ---------- validar / limpar ----------

  /** Confere a montagem; se estiver ok, roda no runner (validation = simula, execution = de verdade). */
  function rodar(modo: ModoDeExecucao) {
    if (validando || rodando) return
    invalidarValidacao()
    setValidando(true)
    timer.current = setTimeout(async () => {
      const encontradas = validarFluxo(getNodes(), getEdges())
      setPendencias(encontradas)
      setValidando(false)
      if (encontradas.length > 0) {
        setValidacao({ok: false, mensagens: encontradas.map(p => p.mensagem)})
        setVerPendencias(true)
        return
      }
      setRodando(modo)
      try {
        idDaExecucao.current = crypto.randomUUID()
        const registro = await executarNoRunner(paraExecutar(nome, parametros, getNodes(), getEdges(), fluxo.id, fluxo.projetoId), modo, idDaExecucao.current, undefined, fluxo.projetoId)
        setExecucao(registro)
        setPendencias(registro.componentes.filter(c => c.status === 'falhou').map(c => ({noId: c.noId, mensagem: `"${c.rotulo}" falhou.`})))
        setValidacao(registro.status === 'falhou'
          ? {ok: false, mensagens: [registro.erro ?? 'A execução falhou.']}
          : {ok: true, mensagens: [registro.status === 'concluida' ? 'Execução concluída.' : registro.status === 'com-avisos' ? 'Execução concluída com avisos.' : 'Execução concluída com erros.']})
      } catch (e) {
        setValidacao({ok: false, mensagens: [e instanceof Error ? e.message : String(e)]})
      } finally {
        setRodando(null)
      }
    }, TEMPO_DE_VALIDACAO_MS)
  }

  /** Organiza o fluxo da esquerda para a direita (Dagre) e enquadra; volta com Ctrl+Z. */
  function organizar() {
    registrar()
    setNodes(atual => organizarHorizontal(atual, getEdges()))
    requestAnimationFrame(() => fitView({padding: 0.15, maxZoom: 1, duration: 300}))
  }

  function limpar() {
    registrar()
    setNodes(atual => atual.filter(ehDoFluxoNo))
    setEdges([])
  }

  return (
    <HistoricoContext.Provider value={historico}>
    <ParametrosContext.Provider value={parametros}>
    <ResultadoContext.Provider value={statusDaUltimaExecucao}>
    <AvisosContext.Provider value={avisos}>
      <div className="flex h-dvh flex-col">
        <Barra
          projeto={{id: fluxo.projetoId ?? PROJETO_DE_EXEMPLOS, nome: obterProjeto(fluxo.projetoId ?? PROJETO_DE_EXEMPLOS)?.nome ?? 'Projeto'}}
          pasta={fluxo.pasta}
          nome={nome}
          onNome={v => {
            setNome(v)
            setAlterado(true)
          }}
          validacao={validacao}
          onExecutar={() => rodar('execution')}
          onParar={() => idDaExecucao.current && cancelarNoRunner(idDaExecucao.current)}
          validando={validando || rodando !== null}
          rodando={rodando}
          onLimpar={limpar}
          onOrganizar={organizar}
          onComentario={adicionarComentario}
          onGrupo={adicionarGrupo}
          onDesfazer={desfazer}
          onRefazer={refazer}
          podeDesfazer={tamanhoDoHistorico.passado > 0}
          podeRefazer={tamanhoDoHistorico.futuro > 0}
          alterado={alterado}
          onSalvar={salvar}
          onVerPendencias={() => setVerPendencias(v => !v)}
        />
        <div className="flex min-h-0 flex-1">
          <Paleta onAdicionar={adicionarDaPaleta}/>
          <main ref={wrapperRef} className="relative min-w-0 flex-1" onDragOver={aoArrastarSobre} onDrop={aoSoltar}>
            <h1 className="sr-only">Prancheta do fluxo</h1>
            <ReactFlow
              nodes={nosNaTela}
              edges={ligacoesNaTela}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={aoLigar}
              isValidConnection={ligacaoValida}
              onNodeDoubleClick={(_, n) => {
                if (n.type === 'componente' && (ehComponente(n) && (!ehDoFluxoNo(n) || n.data.tipo === INICIO))) abrirJanela(n.id)
              }}
              zoomOnDoubleClick={false}
              elevateNodesOnSelect={false}
              onNodeDragStart={comecarArraste}
              onNodeDrag={arrastar}
              onSelectionDragStart={registrar}
              onBeforeDelete={async () => {
                registrar()
                return true
              }}
              defaultEdgeOptions={{type: 'default'}}
              selectionOnDrag
              selectionMode={SelectionMode.Partial}
              panOnDrag={[1, 2]}
              panOnScroll
              zoomActivationKeyCode={['Meta', 'Control']}
              multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
              snapToGrid
              snapGrid={[20, 20]}
              fitView
              fitViewOptions={{padding: 0.15, maxZoom: 1}}
              minZoom={0.2}
              deleteKeyCode={['Backspace', 'Delete']}
              proOptions={{hideAttribution: true}}
            >
              <Background id="menor" variant={BackgroundVariant.Lines} gap={20} color="var(--grid)" lineWidth={0.5}/>
              <Background id="maior" variant={BackgroundVariant.Lines} gap={100} color="var(--grid)" lineWidth={1}/>
              <Controls position="bottom-left" showInteractive={false}/>
              <MiniMap
                position="bottom-right"
                pannable
                zoomable
                nodeColor={n => {
                  const no = n as NoDoFluxo
                  if (no.type === 'grupo') return `color-mix(in oklch, ${no.data.cor} 20%, transparent)`
                  if (!ehComponente(no)) return 'color-mix(in oklch, var(--comentario) 45%, transparent)'
                  const categoria = POR_TIPO[no.data.tipo]?.categoria
                  return categoria ? COR_DA_CATEGORIA[categoria] : 'var(--muted)'
                }}
                nodeBorderRadius={4}
              />
            </ReactFlow>

            {nodes.every(ehDoFluxoNo) && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <p className="rounded-md border border-dashed border-border bg-background/80 px-4 py-3 text-sm text-muted-foreground">
                  Arraste componentes da lateral para começar seu fluxo.
                </p>
              </div>
            )}

            {verPendencias && pendencias.length > 0 && (
              <section className="absolute bottom-4 left-1/2 z-10 flex max-h-64 w-[min(640px,calc(100%-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-destructive/40 bg-background/95 shadow-xl backdrop-blur-sm"
                       aria-label="Pendências do fluxo">
                <header className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm font-medium text-destructive">
                  <CircleAlert className="size-4" aria-hidden="true"/>
                  {pendencias.length} pendência{pendencias.length === 1 ? '' : 's'} · clique para ir ao componente
                  <button type="button" onClick={() => setVerPendencias(false)} className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                          aria-label="Fechar pendências">
                    <X className="size-4" aria-hidden="true"/>
                  </button>
                </header>
                <ul className="overflow-y-auto py-1 text-sm">
                  {pendencias.map((p, i) => (
                    <li key={i}>
                      <button type="button" onClick={() => irPara(p.noId)} className="w-full px-3 py-1.5 text-left hover:bg-accent">{p.mensagem}</button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <div data-janelas className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
              {janelas.map((j, i) => {
                const no = nodes.find(n => n.id === j.id)
                if (!no || !ehComponente(no)) return null
                const ativa = i === janelas.length - 1
                const comum = {
                  posicao: j.posicao, tamanhoInicial: j.tamanho, z: i + 1, ativa,
                  onMover: (p: PosicaoDaJanela) => moverJanela(j.id, p),
                  onRedimensionar: (t: TamanhoDaJanela) => lembrarJanela(j.id, {tamanho: t}),
                  onFocar: () => focarJanela(j.id),
                  onFechar: () => fecharJanela(j.id),
                }
                if (no.data.tipo === INICIO) {
                  return (
                    <Janela key={j.id} {...comum} rotulo="Parâmetros do workflow" titulo="Start" subtitulo="Parâmetros do workflow"
                            icone={<span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-flow/15 text-flow"><Play className="size-5" aria-hidden="true"/></span>}>
                      <PainelDoWorkflow parametros={parametros} onChange={p => {
                        setParametros(p)
                        setAlterado(true)
                      }}
                        recebeEntrada={no.data.config.recebeEntrada === true}
                        onRecebeEntrada={sim => mudarConfig(no.id, 'recebeEntrada', sim)}
                        entradaDeTeste={String(no.data.config.entradaDeTeste ?? '')}
                        onEntradaDeTeste={json => mudarConfig(no.id, 'entradaDeTeste', json)}/>
                    </Janela>
                  )
                }
                const def = POR_TIPO[no.data.tipo]
                if (!def) return null
                const cat = CATEGORIAS[def.categoria]
                const Icone = def.icone
                return (
                  <Janela key={j.id} {...comum} onExcluir={() => excluir(no.id)} rotulo={`Configuração de ${no.data.rotulo}`} titulo={no.data.rotulo} subtitulo={def.rotulo}
                          icone={<span className={cn('flex size-9 shrink-0 items-center justify-center rounded-md', cat.corFundo, cat.corTexto)}><Icone className="size-5" aria-hidden="true"/></span>}>
                    <PainelPropriedades
                      no={no as NoComponente}
                      recebeLinhas={recebeLinhas(no as NoComponente, nodes, edges)}
                      onRotulo={mudarRotulo}
                      onDados={mudarDados}
                      onConfig={mudarConfig}
                    />
                  </Janela>
                )
              })}
            </div>
            {execucao && (
              <PainelDaExecucao key={execucao.run.id} registro={execucao} onFechar={() => setExecucao(null)} onIrPara={irPara} nomeDaPorta={nomeDaPorta}/>
            )}
          </main>
        </div>
      </div>
    </AvisosContext.Provider>
    </ResultadoContext.Provider>
    </ParametrosContext.Provider>
    </HistoricoContext.Provider>
  )
}

export function EditorDeFluxo(props: Props) {
  return (
    <ReactFlowProvider>
      <ResizeObserverGuard/>
      <Editor {...props}/>
    </ReactFlowProvider>
  )
}
