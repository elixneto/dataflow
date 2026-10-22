import {Flag, Play} from 'lucide-react'
import {FILTER} from './filter'
import {LOOKUP} from './lookup'
import {AGGREGATE} from './aggregate'
import {COPY} from './copy'
import {DATA_GRID} from './datagrid'
import {MAPPER} from './mapper'
import {TYPESCRIPT} from './typescript'
import {ROUTER} from './router'
import {SQL_SERVER} from './sqlserver'
import {UNIR} from './unir'
import {WORKFLOW_INVOKER} from './workflow'
import type {Categoria, ComponenteDef} from './tipos'

export const CATEGORIAS: Record<Categoria, {rotulo: string; corTexto: string; corFundo: string; corBorda: string}> = {
  fonte: {rotulo: 'Data Sources', corTexto: 'text-file', corFundo: 'bg-file/15', corBorda: 'border-file'},
  transformacao: {rotulo: 'Transformation', corTexto: 'text-transform', corFundo: 'bg-transform/15', corBorda: 'border-transform'},
  codigo: {rotulo: 'Scripting', corTexto: 'text-code', corFundo: 'bg-code/15', corBorda: 'border-code'},
  entidade: {rotulo: 'Destinations', corTexto: 'text-entity', corFundo: 'bg-entity/15', corBorda: 'border-entity'},
  fluxo: {rotulo: 'Flow', corTexto: 'text-flow', corFundo: 'bg-flow/15', corBorda: 'border-flow'},
}

/** Variável CSS da cor da categoria (as variáveis do tema ainda usam os nomes do v0). */
export const COR_DA_CATEGORIA: Record<Categoria, string> = {
  fonte: 'var(--file)',
  transformacao: 'var(--transform)',
  codigo: 'var(--code)',
  entidade: 'var(--entity)',
  fluxo: 'var(--flow)',
}

export const INICIO = 'inicio'
export const FIM = 'fim'

const FLUXO: ComponenteDef[] = [
  {tipo: INICIO, rotulo: 'Start', descricao: 'Ponto de partida do fluxo', categoria: 'fluxo', icone: Play, entradas: [], saidas: ['envelope']},
  {tipo: FIM, rotulo: 'End', descricao: 'Todas as cadeias terminam aqui', categoria: 'fluxo', icone: Flag, entradas: ['qualquer'], saidas: []},
]

/**
 * Componentes que aparecem na paleta, em ordem alfabética dentro de cada seção. Começando do zero: cada componente novo é desenhado
 * (entradas, saídas, card, painel, validação) e acrescentado aqui. Os da primeira versão estão em samples/referencia.
 */
export const PALETA: ComponenteDef[] = [MAPPER, DATA_GRID, FILTER, ROUTER, LOOKUP, UNIR, COPY, AGGREGATE, TYPESCRIPT, SQL_SERVER, WORKFLOW_INVOKER]
  .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'en'))

export const POR_TIPO: Record<string, ComponenteDef> = Object.fromEntries([...PALETA, ...FLUXO].map(c => [c.tipo, c]))

export function ehDoFluxo(tipo: string) {
  return tipo === INICIO || tipo === FIM
}

export const DRAG_MIME = 'application/x-dataflow-componente'
