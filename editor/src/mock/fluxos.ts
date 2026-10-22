import type {Edge} from '@xyflow/react'
import type {ParametroDoWorkflow} from '@dataflow/core'
import {FIM, INICIO} from '@/componentes/catalogo'
import type {NoComentario} from '@/editor/no-comentario'
import type {NoGrupo} from '@/editor/no-grupo'
import type {NoComponente} from '@/editor/no-componente'
import {PROJETO_DE_EXEMPLOS} from './projetos'

/*
 * Fluxos mockados, guardados no localStorage do navegador. Quando o backend existir, isto vira chamadas à API
 * e os fluxos passam a ficar no banco.
 */

export type NoDoFluxo = NoComponente | NoComentario | NoGrupo

export type Fluxo = {
  id: string
  /** projeto dono do fluxo (fluxo antigo sem projeto fica no de exemplos) */
  projetoId?: string
  /** pasta dentro do projeto, como caminho ("Vendas/Notas"); vazio = raiz */
  pasta?: string
  nome: string
  descricao: string
  status: 'rascunho' | 'publicado'
  versao: number
  atualizadoEm: string
  /** parâmetros que o workflow espera (cada gatilho passa os valores; o que faltar usa o padrão) */
  parametros?: ParametroDoWorkflow[]
  nodes: NoDoFluxo[]
  edges: Edge[]
}

// v2: os fluxos da primeira versão usam componentes que foram para samples/referencia
const CHAVE = 'dataflow-fluxos-v2'

function componente(id: string, tipo: string, rotulo: string, x: number, y: number, config: Record<string, unknown> = {}): NoComponente {
  return {id, type: 'componente', position: {x, y}, data: {tipo, rotulo, config}}
}

export function fluxoVazio(projetoId: string, pasta = ''): Fluxo {
  return {
    id: 'f-' + Date.now().toString(36), projetoId, pasta, nome: 'Novo fluxo', descricao: '', status: 'rascunho', versao: 0,
    atualizadoEm: new Date().toISOString(),
    parametros: [],
    nodes: [
      {...componente(INICIO, INICIO, 'Start', 0, 100), deletable: false},
      {...componente(FIM, FIM, 'End', 900, 100), deletable: false},
    ],
    edges: [],
  }
}

// ---------- Exemplo fixo: recriado a cada carregamento (o que for mudado nele não fica) ----------

export const ID_DO_EXEMPLO = 'exemplo-erros'

const ITENS_DE_EXEMPLO = Array.from({length: 10}, (_, i) => {
  const id = i + 1
  // os itens 3 e 7 vêm sem preço: o Mapper 1 dá erro neles e eles vão para a porta de erro
  return id === 3 || id === 7 ? {id, nome: `Item ${id}`} : {id, nome: `Item ${id}`, preco: id * 10.5}
})

function comOverride(no: NoComponente): NoComponente {
  return {...no, data: {...no.data, override: true}}
}

function comChave(no: NoComponente, chaveDeSaida: string): NoComponente {
  return {...no, data: {...no.data, chaveDeSaida}}
}

function ligar(origem: string, destino: string, saida = 'out-0', entrada = 'in-0'): Edge {
  return {id: `e-${origem}-${saida}-${destino}-${entrada}`, source: origem, sourceHandle: saida, target: destino, targetHandle: entrada}
}

/** Lista de 10 itens → Mapper 1 (2 dão erro e são desviados) → Mapper 2 trata o erro → Union → Fim. */
function fluxoDeExemplo(): Fluxo {
  return {
    id: ID_DO_EXEMPLO, nome: 'Exemplo: erros desviados', status: 'rascunho', versao: 0, atualizadoEm: new Date().toISOString(),
    descricao: '10 itens; 2 sem preço dão erro no Mapper 1, são desviados, tratados no Mapper 2 e reunidos no Union antes do End.',
    parametros: [],
    nodes: [
      {...componente(INICIO, INICIO, 'Start', 0, 200, {recebeEntrada: true, entradaDeTeste: JSON.stringify(ITENS_DE_EXEMPLO, null, 2)}), deletable: false},
      componente('mapper1', 'mapper', 'Mapper 1', 320, 120, {
        seErro: 'desviar',
        campos: [{destino: 'precoFormatado', valor: '"R$ " + $preco.toFixed(2)', expression: true}],
      }),
      comOverride(componente('mapper2', 'mapper', 'Mapper 2', 660, 380, {
        campos: [{destino: 'id', valor: '$id', expression: true}, {destino: 'status', valor: 'ERRO', expression: false}],
      })),
      componente('union', 'union', 'Union', 1000, 160, {qtdEntradas: 2}),
      {...componente(FIM, FIM, 'End', 1340, 200), deletable: false},
    ],
    edges: [
      ligar(INICIO, 'mapper1'),
      ligar('mapper1', 'union', 'out-0', 'in-0'),
      ligar('mapper1', 'mapper2', 'erro', 'in-0'),
      ligar('mapper2', 'union', 'out-0', 'in-1'),
      ligar('union', FIM),
    ],
  }
}

export const ID_DO_EXEMPLO_FILTER = 'exemplo-filter'

/** Lista de 10 itens → Filter ($preco > 50) → um Mapper em cada saída → Union → End. */
function fluxoDeExemploDoFilter(): Fluxo {
  const faixa = (id: string, rotulo: string, x: number, y: number, valor: string) =>
    componente(id, 'mapper', rotulo, x, y, {campos: [{destino: 'faixa', valor, expression: false}]})
  const itens = Array.from({length: 10}, (_, i) => ({id: i + 1, nome: `Item ${i + 1}`, preco: (i + 1) * 10.5}))
  return {
    id: ID_DO_EXEMPLO_FILTER, nome: 'Exemplo: Filter', status: 'rascunho', versao: 0, atualizadoEm: new Date().toISOString(),
    descricao: '10 itens; o Filter separa os de preço acima de 50 (true) dos outros (false), cada lado ganha a sua faixa e o Union junta tudo.',
    parametros: [],
    nodes: [
      {...componente(INICIO, INICIO, 'Start', 0, 200, {recebeEntrada: true, entradaDeTeste: JSON.stringify(itens, null, 2)}), deletable: false},
      componente('filter', 'filter', 'Filter', 320, 160, {condicao: '$preco > 50'}),
      faixa('caro', 'Caros', 700, 40, 'CARO'),
      faixa('barato', 'Baratos', 700, 300, 'BARATO'),
      componente('union', 'union', 'Union', 1080, 160, {qtdEntradas: 2}),
      {...componente(FIM, FIM, 'End', 1420, 200), deletable: false},
    ],
    edges: [
      ligar(INICIO, 'filter'),
      ligar('filter', 'caro', 'out-0'),
      ligar('filter', 'barato', 'out-1'),
      ligar('caro', 'union', 'out-0', 'in-0'),
      ligar('barato', 'union', 'out-0', 'in-1'),
      ligar('union', FIM),
    ],
  }
}

export const ID_DO_EXEMPLO_ROUTER = 'exemplo-router'

/** 10 empresas → Router por UF (SP, Sul, else) → um Mapper por saída grava a região → Union → End. */
function fluxoDeExemploDoRouter(): Fluxo {
  const ufs = ['SP', 'RS', 'BA', 'SP', 'SC', 'MG', 'PR', 'SP', 'PE', 'RS']
  const empresas = ufs.map((uf, i) => ({id: i + 1, nome: `Empresa ${i + 1}`, uf}))
  const regiao = (id: string, rotulo: string, x: number, y: number, valor: string) =>
    componente(id, 'mapper', rotulo, x, y, {campos: [{destino: 'regiao', valor, expression: false}]})
  return {
    id: ID_DO_EXEMPLO_ROUTER, nome: 'Exemplo: Router', status: 'rascunho', versao: 0, atualizadoEm: new Date().toISOString(),
    descricao: '10 empresas; o Router separa SP, Sul e o resto (else), cada saída grava a região e o Union junta tudo.',
    parametros: [],
    nodes: [
      {...componente(INICIO, INICIO, 'Start', 0, 220, {recebeEntrada: true, entradaDeTeste: JSON.stringify(empresas, null, 2)}), deletable: false},
      componente('router', 'router', 'Router por UF', 320, 180, {casos: [
        {rotulo: 'SP', condicao: '$uf === "SP"'},
        {rotulo: 'Sul', condicao: '["PR", "SC", "RS"].includes($uf)'},
      ]}),
      regiao('sp', 'São Paulo', 720, 20, 'SP'),
      regiao('sul', 'Sul', 720, 220, 'SUL'),
      regiao('outras', 'Outras', 720, 420, 'OUTRAS'),
      componente('union', 'union', 'Union', 1100, 200, {qtdEntradas: 3}),
      {...componente(FIM, FIM, 'End', 1440, 240), deletable: false},
    ],
    edges: [
      ligar(INICIO, 'router'),
      ligar('router', 'sp', 'out-0'),
      ligar('router', 'sul', 'out-1'),
      ligar('router', 'outras', 'out-2'),
      ligar('sp', 'union', 'out-0', 'in-0'),
      ligar('sul', 'union', 'out-0', 'in-1'),
      ligar('outras', 'union', 'out-0', 'in-2'),
      ligar('union', FIM),
    ],
  }
}

export const ID_DO_EXEMPLO_LOOKUP = 'exemplo-lookup'

/**
 * Atendimentos e empresas chegam juntos no Start; o Router separa as empresas (consulta) dos atendimentos (principal)
 * e o Lookup grava em cada atendimento a empresa achada pelo código ($empresa); o Mapper tira o id e o nome.
 * O código 99 não existe: $empresa fica null e o Mapper usa o padrão.
 */
function fluxoDeExemploDoLookup(): Fluxo {
  const empresas = [
    {tipo: 'empresa', codigo: 10, id: 'emp-alfa', nome: 'Alfa Ltda'},
    {tipo: 'empresa', codigo: 20, id: 'emp-beta', nome: 'Beta S.A.'},
    {tipo: 'empresa', codigo: 30, id: 'emp-gama', nome: 'Gama ME'},
  ]
  const codigos = [10, 20, 30, 10, 99, 20, 10, 30]
  const atendimentos = codigos.map((codigoEmpresa, i) => ({tipo: 'atendimento', id: i + 1, data: `2026-10-${String(i + 1).padStart(2, '0')}`, codigoEmpresa}))
  return {
    id: ID_DO_EXEMPLO_LOOKUP, nome: 'Exemplo: Lookup', status: 'rascunho', versao: 0, atualizadoEm: new Date().toISOString(),
    descricao: '8 atendimentos e 3 empresas; o Lookup acha a empresa de cada atendimento pelo código e o Mapper tira o id e o nome (o 99 não existe e fica com o padrão).',
    parametros: [],
    nodes: [
      {...componente(INICIO, INICIO, 'Start', 0, 200, {recebeEntrada: true, entradaDeTeste: JSON.stringify([...atendimentos, ...empresas], null, 2)}), deletable: false},
      componente('separa', 'router', 'Empresa ou atendimento?', 320, 160, {casos: [{rotulo: 'empresa', condicao: '$tipo === "empresa"'}]}),
      comChave(componente('lookup', 'lookup', 'Empresa do atendimento', 720, 160, {
        chaves: [{principal: '$codigoEmpresa', consulta: '$codigo'}],
        seNaoEncontrar: 'nulo',
      }), 'empresa'),
      componente('campos', 'mapper', 'Campos da empresa', 1100, 160, {campos: [
        {destino: 'empresaId', valor: '$empresa?.id ?? null', expression: true},
        {destino: 'nomeDaEmpresa', valor: '$empresa?.nome ?? "(sem empresa)"', expression: true},
      ]}),
      {...componente(FIM, FIM, 'End', 1480, 200), deletable: false},
    ],
    edges: [
      ligar(INICIO, 'separa'),
      ligar('separa', 'lookup', 'out-1', 'in-0'),
      ligar('separa', 'lookup', 'out-0', 'in-1'),
      ligar('lookup', 'campos'),
      ligar('campos', FIM),
    ],
  }
}

export const ID_DO_EXEMPLO_TYPESCRIPT = 'exemplo-typescript'

const CODIGO_DE_EXEMPLO = `type Pedido = {id: number; cliente: string; itens: {produto: string; valor: number}[]}

async function process($input: {items: Pedido[]}): Promise<Data[]> {
  log(\`lote com \${$input.items.length} pedido(s)\`)
  return $input.items.map(pedido => ({
    id: pedido.id,
    cliente: pedido.cliente.toUpperCase(),
    total: total(pedido),
    faixa: total(pedido) > 100 ? 'ALTA' : 'BAIXA',
    origem: $PARAMETERS.origem,
  }))
}

function total(pedido: Pedido) {
  return pedido.itens.reduce((soma, item) => soma + item.valor, 0)
}
`

/** 7 pedidos → Aggregate (lotes de 3) → TypeScript (total, faixa, cliente em maiúsculas e o parâmetro origem) → End. */
function fluxoDeExemploDoTypescript(): Fluxo {
  const pedidos = Array.from({length: 7}, (_, i) => ({
    id: i + 1, cliente: `cliente ${i + 1}`,
    itens: Array.from({length: (i % 3) + 1}, (_, j) => ({produto: `P${j + 1}`, valor: 25 * (i + j + 1)})),
  }))
  return {
    id: ID_DO_EXEMPLO_TYPESCRIPT, nome: 'Exemplo: TypeScript', status: 'rascunho', versao: 0, atualizadoEm: new Date().toISOString(),
    descricao: '7 pedidos; o Aggregate junta em lotes de 3 e a função process em TypeScript calcula o total de cada pedido do lote.',
    parametros: [{nome: 'origem', tipo: 'texto', padrao: 'ERP'}],
    nodes: [
      {...componente(INICIO, INICIO, 'Start', 0, 200, {recebeEntrada: true, entradaDeTeste: JSON.stringify(pedidos, null, 2)}), deletable: false},
      componente('agg', 'aggregate', 'Lotes de 3', 320, 190, {tamanho: 3, campo: 'items'}),
      comOverride(componente('ts', 'typescript', 'Calcula o total', 720, 180, {codigo: CODIGO_DE_EXEMPLO})),
      {...componente(FIM, FIM, 'End', 1120, 200), deletable: false},
    ],
    edges: [ligar(INICIO, 'agg'), ligar('agg', 'ts'), ligar('ts', FIM)],
  }
}

export const ID_DO_EXEMPLO_DATA_GRID = 'exemplo-data-grid'

/**
 * Sem entrada no Start: o Copy manda o envelope do Start para dois Data Grids, um com os atendimentos (principal) e
 * outro com o de-para de empresas (consulta), e o Lookup grava o nome da empresa em cada atendimento. O código 40 não existe.
 */
function fluxoDeExemploDoDataGrid(): Fluxo {
  return {
    id: ID_DO_EXEMPLO_DATA_GRID, nome: 'Exemplo: Data Grid e Copy', status: 'rascunho', versao: 0, atualizadoEm: new Date().toISOString(),
    descricao: 'O Copy chama dois Data Grids (5 atendimentos e o de-para de empresas); o Lookup grava o nome da empresa em cada atendimento.',
    parametros: [],
    nodes: [
      {...componente(INICIO, INICIO, 'Start', 0, 200), deletable: false},
      componente('copy', 'copy', 'Copy', 260, 190, {qtdSaidas: 2}),
      componente('atendimentos', 'datagrid', 'Atendimentos', 560, 60, {
        colunas: [{nome: 'id', tipo: 'numero'}, {nome: 'data', tipo: 'texto'}, {nome: 'codigoEmpresa', tipo: 'numero'}],
        linhas: [['1', '2026-10-01', '10'], ['2', '2026-10-02', '20'], ['3', '2026-10-03', '10'], ['4', '2026-10-04', '30'], ['5', '2026-10-05', '40']],
      }),
      componente('empresas', 'datagrid', 'De-para de empresas', 560, 320, {
        colunas: [{nome: 'codigo', tipo: 'numero'}, {nome: 'nome', tipo: 'texto'}, {nome: 'ativa', tipo: 'booleano'}],
        linhas: [['10', 'Alfa Ltda', 'sim'], ['20', 'Beta S.A.', 'sim'], ['30', 'Gama ME', 'não']],
      }),
      comChave(componente('lookup', 'lookup', 'Empresa do atendimento', 940, 160, {
        chaves: [{principal: '$codigoEmpresa', consulta: '$codigo'}],
        seNaoEncontrar: 'nulo',
      }), 'empresa'),
      componente('campos', 'mapper', 'Campos da empresa', 1320, 160, {campos: [
        {destino: 'nomeDaEmpresa', valor: '$empresa?.nome ?? "(sem empresa)"', expression: true},
        {destino: 'empresaAtiva', valor: '$empresa?.ativa ?? false', expression: true},
      ]}),
      {...componente(FIM, FIM, 'End', 1700, 200), deletable: false},
    ],
    edges: [
      ligar(INICIO, 'copy'),
      ligar('copy', 'atendimentos', 'out-0'),
      ligar('copy', 'empresas', 'out-1'),
      ligar('atendimentos', 'lookup', 'out-0', 'in-0'),
      ligar('empresas', 'lookup', 'out-0', 'in-1'),
      ligar('lookup', 'campos'),
      ligar('campos', FIM),
    ],
  }
}

export const ID_DO_EXEMPLO_SQL_SERVER = 'exemplo-sql-server'

/** Lista as tabelas de um banco SQL Server qualquer (segredo MEU_BANCO_SQL no runner/secrets.local.json). */
function fluxoDeExemploDoSqlServer(): Fluxo {
  return {
    id: ID_DO_EXEMPLO_SQL_SERVER, nome: 'Exemplo: SQL Server Query', status: 'rascunho', versao: 0, atualizadoEm: new Date().toISOString(),
    descricao: 'Lista as tabelas de um banco SQL Server (crie o segredo MEU_BANCO_SQL com a connection string na aba Segredos).',
    parametros: [{nome: 'limite', tipo: 'numero', padrao: '20'}],
    nodes: [
      {...componente(INICIO, INICIO, 'Start', 0, 200), deletable: false},
      comOverride(componente('tabelas', 'sqlserver', 'Tabelas do banco', 300, 170, {
        conexao: 'MEU_BANCO_SQL',
        sql: `SELECT TOP (@limite) name AS tabela, create_date AS criadaEm
FROM sys.tables
ORDER BY name`,
        parametros: [{nome: 'limite', valor: '$PARAMETERS.limite', expression: true}],
        tempoMaximoS: 60,
      })),
      {...componente(FIM, FIM, 'End', 760, 200), deletable: false},
    ],
    edges: [ligar(INICIO, 'tabelas'), ligar('tabelas', FIM)],
  }
}

export const ID_DO_EXEMPLO_INVOKER = 'exemplo-workflow-invoker'
const ID_DO_EXEMPLO_INVOKER_CHAMADO = 'exemplo-workflow-invoker-multiplica'
const ID_DO_EXEMPLO_INVOKER_ERRO = 'exemplo-workflow-invoker-tratamento'

/**
 * Três workflows: o pai solta n = 1, 2, 3 e chama "Multiplica" com vezes = n - 1; com vezes 0 ele falha, e a porta de
 * erro chama o "Tratamento de erro" com o envelope.
 */
function fluxosDeExemploDoInvoker(): Fluxo[] {
  const agora = new Date().toISOString()
  const multiplica: Fluxo = {
    id: ID_DO_EXEMPLO_INVOKER_CHAMADO, nome: 'Exemplo: Invoker (Multiplica)', status: 'rascunho', versao: 0, atualizadoEm: agora,
    descricao: 'Chamado pelo "Exemplo: Workflow Invoker": recebe o envelope e multiplica n pelo parâmetro vezes (vezes 0 falha).',
    parametros: [{nome: 'vezes', tipo: 'numero', padrao: '1', obrigatorio: true}],
    nodes: [
      {...componente(INICIO, INICIO, 'Start', 0, 200, {recebeEntrada: true, entradaDeTeste: '{"n": 5}'}), deletable: false},
      componente('total', 'mapper', 'Total', 320, 180, {campos: [{
        destino: 'total', expression: true,
        valor: '$PARAMETERS.vezes > 0 ? $n * $PARAMETERS.vezes : (() => { throw new Error("vezes precisa ser maior que zero") })()',
      }]}),
      {...componente(FIM, FIM, 'End', 760, 200), deletable: false},
    ],
    edges: [ligar(INICIO, 'total'), ligar('total', FIM)],
  }
  const tratamento: Fluxo = {
    id: ID_DO_EXEMPLO_INVOKER_ERRO, nome: 'Exemplo: Invoker (Tratamento de erro)', status: 'rascunho', versao: 0, atualizadoEm: agora,
    descricao: 'Chamado pela porta de erro do "Exemplo: Workflow Invoker": recebe o envelope que falhou e marca como tratado.',
    parametros: [],
    nodes: [
      {...componente(INICIO, INICIO, 'Start', 0, 200, {recebeEntrada: true}), deletable: false},
      componente('marca', 'mapper', 'Marca como tratado', 320, 180, {campos: [{destino: 'tratado', valor: 'true', expression: true}]}),
      {...componente(FIM, FIM, 'End', 760, 200), deletable: false},
    ],
    edges: [ligar(INICIO, 'marca'), ligar('marca', FIM)],
  }
  const pai: Fluxo = {
    id: ID_DO_EXEMPLO_INVOKER, nome: 'Exemplo: Workflow Invoker', status: 'rascunho', versao: 0, atualizadoEm: agora,
    descricao: 'Chama o "Multiplica" para cada número; o que falha vai pela porta de erro para o "Tratamento de erro".',
    parametros: [],
    nodes: [
      {...componente(INICIO, INICIO, 'Start', 0, 200), deletable: false},
      componente('numeros', 'datagrid', 'Números', 260, 180, {colunas: [{nome: 'n', tipo: 'numero'}], linhas: [['1'], ['2'], ['3']]}),
      componente('multiplica', 'workflow', 'Multiplica', 620, 170, {
        workflowId: ID_DO_EXEMPLO_INVOKER_CHAMADO, enviarEnvelope: true, seErro: 'desviar',
        parametros: [{nome: 'vezes', valor: '$n - 1', expression: true}],
      }),
      componente('tratamento', 'workflow', 'Tratamento de erro', 1000, 380, {workflowId: ID_DO_EXEMPLO_INVOKER_ERRO, enviarEnvelope: true, parametros: []}),
      {...componente(FIM, FIM, 'End', 1380, 200), deletable: false},
    ],
    edges: [
      ligar(INICIO, 'numeros'), ligar('numeros', 'multiplica'), ligar('multiplica', FIM),
      ligar('multiplica', 'tratamento', 'erro'), ligar('tratamento', FIM),
    ],
  }
  return [pai, multiplica, tratamento]
}

/** Pasta de fábrica de cada exemplo. */
function pastaDoExemplo(id: string) {
  if (id === ID_DO_EXEMPLO_SQL_SERVER) return 'Fontes de dados'
  if (id.startsWith(ID_DO_EXEMPLO_INVOKER)) return 'Workflow Invoker'
  return 'Componentes'
}

/** Todos os exemplos ficam no projeto de exemplos. */
function projetoDoExemplo(_id: string) {
  return PROJETO_DE_EXEMPLOS
}

const EXEMPLOS = () => [
  fluxoDeExemplo(), fluxoDeExemploDoFilter(), fluxoDeExemploDoRouter(), fluxoDeExemploDoLookup(), fluxoDeExemploDoTypescript(), fluxoDeExemploDoDataGrid(), fluxoDeExemploDoSqlServer(),
  ...fluxosDeExemploDoInvoker(),
]

export function listarFluxos(): Fluxo[] {
  let salvos: Fluxo[] = []
  try {
    const salvo = localStorage.getItem(CHAVE)
    if (salvo) salvos = JSON.parse(salvo) as Fluxo[]
  } catch {
    // storage indisponível ou corrompido: começa vazio
  }
  // os exemplos sempre voltam ao original
  // o exemplo pode ser movido de pasta (a pasta salva vale; o resto volta ao original)
  const exemplos = EXEMPLOS().map(f => ({
    ...f, projetoId: projetoDoExemplo(f.id), pasta: salvos.find(s => s.id === f.id)?.pasta ?? pastaDoExemplo(f.id),
  }))
  return [...exemplos, ...salvos.filter(f => !exemplos.some(e => e.id === f.id))].map(f => ({...f, projetoId: f.projetoId ?? PROJETO_DE_EXEMPLOS}))
}

/** Move o fluxo para outra pasta do projeto. */
export function moverFluxo(id: string, pasta: string) {
  gravar(listarFluxos().map(f => (f.id === id ? {...f, pasta} : f)))
}

/** Troca o começo do caminho das pastas dos fluxos (pasta renomeada ou movida). */
export function renomearPastaDosFluxos(projetoId: string, de: string, para: string) {
  gravar(listarFluxos().map(f => (f.projetoId === projetoId && dentroDe(f.pasta ?? '', de) ? {...f, pasta: para + (f.pasta ?? '').slice(de.length)} : f)))
}

/** a pasta é `base` ou fica dentro dela */
export const dentroDe = (pasta: string, base: string) => pasta === base || pasta.startsWith(base + '/')

/** Fluxos de um projeto. */
export function fluxosDoProjeto(projetoId: string): Fluxo[] {
  return listarFluxos().filter(f => f.projetoId === projetoId)
}

function gravar(fluxos: Fluxo[]) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(fluxos))
  } catch {
    // sem storage: o mock vale só até recarregar
  }
}

export function obterFluxo(id: string): Fluxo | undefined {
  return listarFluxos().find(f => f.id === id)
}

export function salvarFluxo(fluxo: Fluxo): Fluxo {
  const fluxos = listarFluxos()
  const salvo: Fluxo = {...fluxo, versao: fluxo.versao + 1, atualizadoEm: new Date().toISOString()}
  const existe = fluxos.some(f => f.id === fluxo.id)
  gravar(existe ? fluxos.map(f => f.id === fluxo.id ? salvo : f) : [...fluxos, salvo])
  return salvo
}

export function excluirFluxo(id: string) {
  gravar(listarFluxos().filter(f => f.id !== id))
}

export function duplicarFluxo(id: string): Fluxo | undefined {
  const original = obterFluxo(id)
  if (!original) return undefined
  const copia: Fluxo = {...structuredClone(original), id: 'f-' + Date.now().toString(36), nome: `${original.nome} (cópia)`, status: 'rascunho', versao: 0}
  return salvarFluxo(copia)
}
