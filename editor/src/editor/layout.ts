import {Graph, layout} from '@dagrejs/dagre'
import type {Edge} from '@xyflow/react'
import type {NoDoFluxo} from '@/mock/fluxos'
import {PORTA_DE_ERRO} from './no-componente'

const LARGURA_PADRAO = 320
const ALTURA_PADRAO = 120

/** Posição da porta no card, de cima para baixo: as numeradas pela ordem e a de erro (embaixo do card) por último. */
function ordemDaPorta(handle?: string | null): number {
  if (!handle) return 0
  if (handle === PORTA_DE_ERRO) return 1000
  return Number(handle.match(/(\d+)$/)?.[1] ?? 0)
}

type NoDoDagre = {rank?: number; order?: number; edgeObj?: {v: string; w: string}; borderType?: string; x: number; y: number; width: number; height: number}


type Caixa = {x: number; y: number; w: number; h: number}

function caixaDo(n: NoDoFluxo): Caixa {
  return {x: n.position.x, y: n.position.y, w: n.measured?.width ?? n.width ?? 0, h: n.measured?.height ?? n.height ?? 0}
}

const dentro = (a: Caixa, b: Caixa) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h

/**
 * Organiza os componentes da esquerda para a direita com o Dagre (Start à esquerda, End à direita, cada
 * ramo numa faixa). O que está inteiro dentro de um grupo continua junto: o grupo vira um "cluster" do Dagre e é
 * redimensionado em volta dos seus componentes. Comentários acompanham o grupo em que estão; os soltos ficam onde estão.
 */
export function organizarHorizontal(nos: NoDoFluxo[], ligacoes: Edge[]): NoDoFluxo[] {
  const grupos = nos.filter(n => n.type === 'grupo')
  const componentes = nos.filter(n => n.type === 'componente')

  // grupo de cada nó = o menor grupo que o contém inteiro (grupo dentro de grupo também vale)
  const area = (c: Caixa) => c.w * c.h
  const grupoDe = new Map<string, string>()
  for (const n of [...componentes, ...grupos, ...nos.filter(n => n.type === 'comentario')]) {
    const pai = grupos
      .filter(g => g.id !== n.id && dentro(caixaDo(n), caixaDo(g)) && area(caixaDo(g)) > area(caixaDo(n)))
      .sort((a, b) => area(caixaDo(a)) - area(caixaDo(b)))[0]
    if (pai) grupoDe.set(n.id, pai.id)
  }
  // só entra no Dagre o grupo que tem componente dentro (direto ou num grupo de dentro)
  const comComponente = new Set<string>()
  for (const c of componentes) {
    for (let g = grupoDe.get(c.id); g && !comComponente.has(g); g = grupoDe.get(g)) comComponente.add(g)
  }

  const grafo = new Graph({compound: comComponente.size > 0})
  // Com grupos: a borda do cluster fica a (edgesep + nodesep) / 2 dos componentes (espaço para o título) e dois
  // grupos vizinhos ficam a edgesep um do outro (margem de segurança).
  grafo.setGraph(comComponente.size
    ? {rankdir: 'LR', nodesep: 80, edgesep: 40, ranksep: 160, marginx: 20, marginy: 20}
    : {rankdir: 'LR', nodesep: 60, ranksep: 120, marginx: 20, marginy: 20})
  grafo.setDefaultEdgeLabel(() => ({}))

  for (const n of componentes) {
    grafo.setNode(n.id, {width: n.measured?.width ?? LARGURA_PADRAO, height: n.measured?.height ?? ALTURA_PADRAO})
  }
  for (const id of comComponente) grafo.setNode(id, {})
  for (const id of [...componentes.map(c => c.id), ...comComponente]) {
    const pai = grupoDe.get(id)
    if (pai && comComponente.has(pai)) grafo.setParent(id, pai)
  }
  // porta de saída de cada ligação (origem→destino), para a ordem vertical
  const portaDaLigacao = new Map<string, number>()
  for (const e of ligacoes) {
    if (!componentes.some(c => c.id === e.source) || !componentes.some(c => c.id === e.target)) continue
    grafo.setEdge(e.source, e.target)
    const chave = `${e.source}\u0000${e.target}`
    portaDaLigacao.set(chave, Math.min(portaDaLigacao.get(chave) ?? Infinity, ordemDaPorta(e.sourceHandle)))
  }

  layout(grafo, {
    // O Dagre minimiza cruzamentos sem enxergar as portas, e no empate pode pôr acima o que sai da porta de baixo.
    // Depois da ordem dele, cada coluna é reordenada (da esquerda para a direita) pela posição de quem a alimenta,
    // desempatando pela porta de saída: o que sai da porta de erro fica abaixo do que sai da principal.
    // Só trocam de lugar nós do mesmo grupo (as bordas dos grupos ficam onde o Dagre pôs).
    customOrder: (g, ordemPadrao) => {
      ordemPadrao(g)
      const no = (v: string) => g.node(v) as unknown as NoDoDagre
      const colunas = new Map<number, string[]>()
      for (const v of g.nodes()) {
        const rank = no(v).rank
        if (typeof rank === 'number') colunas.set(rank, [...(colunas.get(rank) ?? []), v])
      }
      const porta = (u: string, v: string) => {
        // nó fictício do Dagre (ligação que pula colunas): a porta é a da ligação original
        const obj = no(u).edgeObj ?? no(v).edgeObj ?? {v: u, w: v}
        return portaDaLigacao.get(`${obj.v}\u0000${obj.w}`) ?? 0
      }
      const movel = (v: string) => !no(v).borderType && (g.children(v) ?? []).length === 0
      for (const rank of [...colunas.keys()].sort((a, b) => a - b).slice(1)) {
        const chave = new Map<string, number>()
        const porPai = new Map<string, string[]>()
        for (const v of colunas.get(rank)!) {
          if (!movel(v)) continue
          const antes = ((g.predecessors(v) ?? []) as string[]).filter(u => typeof no(u).order === 'number')
          chave.set(v, antes.length === 0 ? no(v).order!
            : antes.reduce((s, u) => s + no(u).order! + porta(u, v) / 10000, 0) / antes.length)
          const pai = (g.isCompound() && g.parent(v)) || ''
          porPai.set(pai, [...(porPai.get(pai) ?? []), v])
        }
        for (const irmaos of porPai.values()) {
          const lugares = irmaos.map(v => no(v).order!).sort((a, b) => a - b)
          irmaos
            .sort((a, b) => chave.get(a)! - chave.get(b)! || no(a).order! - no(b).order!)
            .forEach((v, i) => (no(v).order = lugares[i]))
        }
      }
    },
  })

  // grupos: a caixa do cluster (o Dagre devolve o centro e o tamanho, já com a folga em volta dos componentes)
  const novaCaixa = new Map<string, Caixa>()
  for (const id of comComponente) {
    const p = grafo.node(id) as unknown as NoDoDagre
    novaCaixa.set(id, {
      x: p.x - p.width / 2, y: p.y - p.height / 2, w: p.width, h: p.height,
    })
  }
  // comentário (ou grupo sem componente) dentro de um grupo vai junto: mesma posição relativa, na proporção do
  // tamanho novo do grupo e sem sair dele
  const caixaFinal = (id: string): Caixa | undefined => {
    const n = nos.find(o => o.id === id)
    if (!n) return undefined
    const nova = novaCaixa.get(id)
    if (nova) return nova
    const pai = grupoDe.get(id)
    const antiga = pai ? nos.find(o => o.id === pai) : undefined
    const final = pai ? caixaFinal(pai) : undefined
    const c = caixaDo(n)
    if (!antiga || !final) return c
    const a = caixaDo(antiga)
    const x = Math.min(Math.max((c.x - a.x) * (final.w / (a.w || 1)), 0), Math.max(final.w - c.w, 0))
    const y = Math.min(Math.max((c.y - a.y) * (final.h / (a.h || 1)), 0), Math.max(final.h - c.h, 0))
    return {x: final.x + x, y: final.y + y, w: c.w, h: c.h}
  }

  return nos.map(n => {
    if (n.type === 'componente') {
      const p = grafo.node(n.id) as unknown as NoDoDagre | undefined
      if (!p) return n
      // o Dagre devolve o centro; o React Flow posiciona pelo canto superior esquerdo
      return {...n, position: {x: p.x - p.width / 2, y: p.y - p.height / 2}}
    }
    const caixa = novaCaixa.get(n.id)
    if (caixa) return {...n, position: {x: caixa.x, y: caixa.y}, width: caixa.w, height: caixa.h}
    if (!grupoDe.has(n.id)) return n
    const final = caixaFinal(n.id)!
    return {...n, position: {x: final.x, y: final.y}}
  })
}
