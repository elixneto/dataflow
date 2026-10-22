/*
 * Contrato do motor de workflows (plano em _docs/planejamento/workflow-execucao.md).
 * Este pacote não depende de React nem de Node: o editor usa para validar e o runner (Bun) para executar.
 */

export type ModoDeExecucao = 'validation' | 'execution'

export type WorkflowCurrentRun = {
  id: string
  mode: ModoDeExecucao
  project: string
  workflow: string
  startedAt: string
  /** execução que chamou esta (Workflow Invoker); sem ela, foi chamada de fora */
  parentId?: string
}

/** O que passa de um componente para outro (seção 4 do plano). */
export type Envelope = {
  WORKFLOW_CURRENT_RUN: WorkflowCurrentRun
  PARAMETERS: Record<string, unknown>
  DATA: Record<string, unknown>
}

export type TipoDeParametro = 'texto' | 'numero' | 'booleano'

export type ParametroDoWorkflow = {
  nome: string
  tipo: TipoDeParametro
  padrao: string
  obrigatorio?: boolean
}

export type PoliticaDeErro = 'parar' | 'continuar' | 'desviar'

/** Nó do workflow do jeito que o runner recebe (sem posição nem nada visual). */
export type NoParaExecutar = {
  id: string
  tipo: string
  rotulo: string
  config: Record<string, unknown>
  /** nome da chave que o componente acrescenta no DATA */
  chaveDeSaida?: string
  /** a saída leva só a chave deste componente (descarta o resto do DATA) */
  override?: boolean
  desativado?: boolean
}

export type LigacaoParaExecutar = {
  origem: string
  portaDeOrigem: string
  destino: string
  portaDeDestino: string
}

export type WorkflowParaExecutar = {
  /** id do fluxo (o Workflow Invoker chama outro pelo id) */
  id?: string
  projeto: string
  workflow: string
  parametros: ParametroDoWorkflow[]
  nos: NoParaExecutar[]
  ligacoes: LigacaoParaExecutar[]
}

/** Avaliador de expressions. Fica no runner (sandbox do node:vm); o core só recebe a função. */
export type AvaliarExpression = (expression: string, variaveis: Record<string, unknown>) => unknown

export type NivelDeLog = 'info' | 'aviso' | 'erro'

export type LinhaDeLog = {em: string; nivel: NivelDeLog; mensagem: string}

/** A função `process` de um script, pronta para chamar (o runner transpila e isola; ver PrepararScript). */
export type FuncaoDoScript = (input: unknown) => Promise<unknown>

/**
 * Prepara o script de um componente (ex.: TypeScript) uma vez por execução. Fica no runner, como o avaliador de
 * expressions. As globais valem para todas as chamadas do process: $PARAMETERS, $SECRETS, $WORKFLOW_CURRENT_RUN e log.
 */
export type PrepararScript = (codigo: string, globais: {
  run: WorkflowCurrentRun
  parametros: Record<string, unknown>
  segredos: Record<string, string>
  log: (mensagem: string) => void
}) => Promise<FuncaoDoScript>

/** Uma consulta a banco (SQL Server Query): a connection string já vem resolvida do segredo. */
export type ConsultaSql = {
  conexao: string
  sql: string
  /** valores dos @parametros, mandados ao banco como parâmetros (nunca colados no texto) */
  parametros: Record<string, unknown>
  tempoMaximoMs: number
  /** execução interrompida (Parar, tempo máximo, falha em outro componente): cancela a consulta no banco */
  sinal: AbortSignal
}

/**
 * Roda uma consulta somente leitura e solta as linhas uma a uma, com controle de vazão (o banco pausa enquanto o
 * fluxo não consome). Fica no runner (driver do banco); o core só recebe a função, como o avaliador de expressions.
 */
export type ConsultarSql = (consulta: ConsultaSql) => AsyncIterable<Record<string, unknown>>

export type ContextoDoComponente = {
  run: WorkflowCurrentRun
  no: NoParaExecutar
  /** compila o código do componente e devolve a função process (erro de compilação vira exceção) */
  prepararScript: (codigo: string) => Promise<FuncaoDoScript>
  /** avalia um campo que pode ser texto puro ou expression, no contexto de um envelope */
  valorDoCampo: (campo: CampoComExpression, doc: Envelope) => unknown
  log: (nivel: NivelDeLog, mensagem: string) => void
  /**
   * Espera algo que não é uma entrada (ex.: um aviso interno do componente). Use em vez do `await` direto, para essa
   * espera não contar como tempo ativo. A espera pelas entradas o motor já desconta sozinho.
   */
  esperar: <T>(promessa: Promise<T>) => Promise<T>
  /** Igual ao esperar, para ler uma fila interna (ex.: o Union lê a fila em que as entradas despejam). */
  esperarCada: <T>(fonte: AsyncIterable<T>) => AsyncIterable<T>
  /**
   * Quantos envelopes o componente está guardando agora (ex.: a tabela do Lookup, o lote do Aggregate). O motor guarda o
   * pico. Passe o envelope que acabou de guardar: o motor mede alguns para estimar o tamanho.
   */
  guardando: (envelopes: number, guardado?: Envelope) => void
  /**
   * Roda outro workflow (Workflow Invoker) com os valores dos parâmetros do Start dele e, se quiser, uma entrada.
   * `envelopes` solta o DATA de cada envelope que chega ao End dele, conforme chega; `resultado` é o registro dele.
   * Quem chama e para de ler antes do fim chama `cancelar`.
   */
  invocarWorkflow: (workflowId: string, chamada: {parametros: Record<string, string>; entrada?: unknown}) => {
    envelopes: AsyncIterable<Record<string, unknown>>
    resultado: Promise<RegistroDaExecucao>
    cancelar: () => void
  }
  /** consulta no SQL Server (o nome do segredo com a connection string vira a connection string aqui) */
  consultarSql: (consulta: Omit<ConsultaSql, 'conexao' | 'sinal'> & {segredo: string}) => AsyncIterable<Record<string, unknown>>
}

/** Campo de configuração que pode ser texto puro ou expression (o "=" do campo). */
export type CampoComExpression = {valor: string; expression: boolean}

/** O que o executar solta: um envelope numa porta, ou um erro ligado ao envelope que falhou. */
export type SaidaDoComponente =
  | {porta: string; doc: Envelope}
  | {erro: Error; doc: Envelope}

export type Pendencia = string

/**
 * Tipo de uma porta (seção 6 do plano). `envelope`: vários envelopes em sequência (o padrão);
 * `texto`, `numero`, `json` (objeto ou array, um valor só); `qualquer`: coringa, liga com tudo.
 */
export type TipoDePorta = 'envelope' | 'texto' | 'numero' | 'json' | 'qualquer'

export type ComponenteLogica = {
  tipo: string
  /** tipo de cada porta, na ordem (in-0, in-1...) */
  entradas: TipoDePorta[]
  /** tipo de cada porta, na ordem (out-0, out-1...); a porta de erro é sempre `envelope` */
  saidas: TipoDePorta[]
  /** saídas que podem ficar sem ligação: o que sai por elas é descartado sem aviso (ex.: false do Filter, else do Router) */
  saidasOpcionais?: string[] | ((config: Record<string, unknown>) => string[])
  /**
   * Quantidade de entradas escolhida no nó (ex.: Unir, 2 a 100), guardada em config[chave].
   * Todas as entradas têm o tipo de `entradas[0]`.
   */
  entradasVariaveis?: {min: number; max: number; chave: string}
  /** Quantidade de saídas escolhida no nó (ex.: Copy, 2 a 10), guardada em config[chave]; todas do tipo de `saidas[0]`. */
  saidasVariaveis?: {min: number; max: number; chave: string}
  /**
   * Chave padrão no DATA onde o componente põe o que produz (o nó pode trocar).
   * Sem ela, o componente escreve direto nos campos do DATA (ex.: Mapper).
   */
  chaveDeSaidaPadrao?: string
  /** pendências de configuração (sem dados): mensagens curtas, sem o nome do componente */
  validar: (config: Record<string, unknown>) => Pendencia[]
  /** envelope a envelope (seção 7 do plano) */
  executar: (entradas: Record<string, AsyncIterable<Envelope>>, config: Record<string, unknown>, ctx: ContextoDoComponente) => AsyncIterable<SaidaDoComponente>
}

// ---------- registro da execução (seção 10) ----------

export type StatusDaExecucao = 'concluida' | 'com-avisos' | 'com-erros' | 'falhou'

export type ExecucaoDoComponente = {
  noId: string
  rotulo: string
  tipo: string
  /**
   * desativado = bypass (não executou, só repassou); com-avisos = rodou, mas algo merece atenção
   * (ex.: envelopes descartados por saída sem ligação, nada chegou ao Fim)
   */
  status: 'nao-executou' | 'concluido' | 'desativado' | 'com-avisos' | 'com-erros' | 'falhou'
  inicio?: string
  fim?: string
  duracaoMs?: number
  /**
   * Tempo em que o componente esteve processando, sem contar a espera por envelopes nem pelo próximo componente.
   * Como tudo roda numa thread só, é praticamente o CPU dele. Inclui o que o script aguarda por dentro (ex.: uma chamada HTTP).
   */
  tempoAtivoMs?: number
  /** workflows que o componente chamou (Workflow Invoker): um resumo de cada execução, até 50 */
  subexecucoes?: {id: string; workflow: string; status: StatusDaExecucao; duracaoMs: number; erro?: string}[]
  /** O que o componente guardou de uma vez (só quem acumula: Lookup, Aggregate). Bytes estimados pelo JSON do DATA. */
  memoria?: {picoDeEnvelopes: number; picoDeBytes: number}
  /** envelopes por porta */
  entradas: Record<string, number>
  saidas: Record<string, number>
  logs: LinhaDeLog[]
  /** só o DATA dos primeiros envelopes */
  amostraDeEntrada: Record<string, unknown>[]
  amostraDeSaida: Record<string, Record<string, unknown>[]>
}

export type RegistroDaExecucao = {
  run: WorkflowCurrentRun
  parametros: Record<string, unknown>
  status: StatusDaExecucao
  fim: string
  duracaoMs: number
  erro?: string
  componentes: ExecucaoDoComponente[]
}
