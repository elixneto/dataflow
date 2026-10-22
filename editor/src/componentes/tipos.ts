import type {ComponentType} from 'react'
import type {LucideIcon} from 'lucide-react'
import type {TipoDePorta} from '@dataflow/core'

export type Categoria = 'fonte' | 'transformacao' | 'codigo' | 'entidade' | 'fluxo'

/** Configuração de um componente no fluxo. Cada componente lê o que precisa com os helpers de `config.ts`. */
export type Config = Record<string, unknown>

export type CamposProps = {
  /** id para labels e inputs únicos (não é o id do nó: a janela usa outro) */
  id: string
  /** id do nó no fluxo */
  noId: string
  config: Config
  setConfig: (chave: string, valor: unknown) => void
  /** o componente recebe linhas de outro (não só o Início) */
  recebeLinhas: boolean
}

export type ContextoDeValidacao = {
  recebeLinhas: boolean
}

/**
 * Definição de um componente da paleta. Cada componente mora num arquivo próprio em `componentes/`
 * e é aqui que, depois, entra a lógica dele (ler arquivo, transformar linhas, gravar no destino).
 */
export type ComponenteDef = {
  tipo: string
  rotulo: string
  descricao: string
  categoria: Categoria
  icone: LucideIcon
  /** tipo de cada entrada, na ordem (in-0, in-1...) */
  entradas: TipoDePorta[]
  /** nome de cada entrada, mostrado ao lado da porta (ex.: principal/consulta do Lookup) */
  rotulosDasEntradas?: string[]
  /** tipo de cada saída, na ordem (out-0, out-1...) */
  saidas: TipoDePorta[]
  /** nome de cada saída, mostrado ao lado da porta (ex.: true/false do Filter); sem ele, as saídas não têm nome */
  rotulosDasSaidas?: string[]
  /** saídas que podem ficar sem ligação (ex.: false do Filter) */
  saidasOpcionais?: string[] | ((config: Config) => string[])
  /**
   * Saídas que dependem da configuração (ex.: um caso do Router = uma saída), todas de envelopes.
   * Quando existe, vale no lugar de `saidas` e `rotulosDasSaidas`.
   */
  saidasDaConfig?: (config: Config) => {rotulo: string}[]
  /** componente que não tem como falhar por envelope (ex.: Unir): sem "Em caso de erro" e sem porta de erro */
  semErro?: boolean
  /** quantidade de entradas escolhida no card (−/+), guardada em config[chave]; todas do tipo de entradas[0] */
  entradasVariaveis?: {min: number; max: number; chave: string}
  /** quantidade de saídas escolhida no card (−/+), guardada em config[chave]; todas do tipo de saidas[0] (ex.: Copy) */
  saidasVariaveis?: {min: number; max: number; chave: string}
  /** entrada que pode ficar sem ligação (ex.: arquivo, que só recebe linhas quando vincula) */
  entradasOpcionais?: boolean
  configPadrao?: Config
  /** tamanho da janela na primeira vez que abre (ex.: o TypeScript, que tem um editor de código) */
  tamanhoDaJanela?: {w: number; h: number}
  /** mostra o Override na janela (a saída leva só o que o componente produz) */
  usaOverride?: boolean
  /** nome padrão da chave que o componente acrescenta no DATA (o nó pode trocar) */
  chaveDeSaidaPadrao?: string
  /** o que aparece dentro do card na prancheta */
  Card?: ComponentType<CamposProps>
  /** o que aparece na aba Configuração da janela; sem ele, usa o Card */
  Painel?: ComponentType<CamposProps>
  /** explicação do componente na aba Notes (entradas, saídas, exemplos) */
  Documentacao?: ComponentType
  /** pendências de configuração (mensagens curtas, sem o nome do componente) */
  validar?: (config: Config, ctx: ContextoDeValidacao) => string[]
}
