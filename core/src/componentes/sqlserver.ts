import {comoErro, mesclar} from '../envelope'
import type {CampoComExpression, ComponenteLogica} from '../tipos'

/**
 * SQL Server Query (no Kettle, Table input): roda uma consulta somente leitura e solta um envelope por linha, com as
 * colunas gravadas no DATA (como o Data Grid; Override = só as colunas). Roda uma vez para cada envelope que chega
 * (em geral o único que o Start solta). Ex.: ler os pedidos de um ERP.
 *
 * A conexão é o nome de um segredo com a connection string (ela não aparece no fluxo nem nos logs). Os `@nome` da
 * consulta são parâmetros com expression avaliada no envelope que chegou, mandados ao banco como parâmetro (nunca
 * colados no texto). Somente leitura em três camadas: aqui só passa SELECT/WITH (ver `problemaDeSomenteLeitura`),
 * e o runner roda dentro de uma transação que sempre faz rollback, com ApplicationIntent=ReadOnly.
 */

export type ParametroDoSql = CampoComExpression & {nome: string}

export const TEMPO_MAXIMO_PADRAO_DO_SQL_S = 300

export function configDoSqlServer(config: Record<string, unknown>) {
  const tempo = Math.round(Number(config.tempoMaximoS ?? TEMPO_MAXIMO_PADRAO_DO_SQL_S))
  return {
    conexao: typeof config.conexao === 'string' ? config.conexao : '',
    sql: typeof config.sql === 'string' ? config.sql : '',
    parametros: Array.isArray(config.parametros) ? (config.parametros as ParametroDoSql[]) : [],
    tempoMaximoS: Number.isFinite(tempo) && tempo > 0 ? tempo : TEMPO_MAXIMO_PADRAO_DO_SQL_S,
  }
}

/**
 * Tira comentários, textos entre aspas e nomes entre colchetes, para as checagens não olharem dentro deles.
 * Lê da esquerda para a direita, como o SQL Server: o que abre primeiro manda (`'--'` é texto, não comentário), e
 * comentário de bloco pode ser aninhado (um bloco dentro de outro). Texto ou comentário sem fechar vai até o fim.
 */
export function semTextos(sql: string) {
  let saida = ''
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    const dois = sql.slice(i, i + 2)
    if (dois === '--') {
      const fim = sql.indexOf('\n', i)
      i = fim < 0 ? sql.length : fim
      saida += ' '
    } else if (dois === '/*') {
      let nivel = 0
      while (i < sql.length) {
        if (sql.startsWith('/*', i)) { nivel++; i += 2 }
        else if (sql.startsWith('*/', i)) { nivel--; i += 2; if (nivel === 0) break }
        else i++
      }
      saida += ' '
    } else if (c === "'" || c === '"' || c === '[') {
      const fecha = c === '[' ? ']' : c
      i++
      // aspas dobradas ('' ou ]]) são o próprio caractere dentro do texto
      while (i < sql.length && !(sql[i] === fecha && sql[i + 1] !== fecha)) i += sql[i] === fecha ? 2 : 1
      i++
      saida += c === '[' ? '[]' : `${c}${c}`
    } else {
      saida += c
      i++
    }
  }
  return saida
}

/** Palavras que escrevem, mudam a estrutura, executam código ou saem do banco. */
const PROIBIDAS = [
  'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'TRUNCATE', 'DROP', 'ALTER', 'CREATE', 'GRANT', 'REVOKE', 'DENY',
  'EXEC', 'EXECUTE', 'INTO', 'BACKUP', 'RESTORE', 'DBCC', 'SHUTDOWN', 'KILL', 'BULK', 'OPENROWSET', 'OPENQUERY',
  'OPENDATASOURCE', 'OPENXML', 'USE', 'WAITFOR', 'RECONFIGURE', 'CHECKPOINT', 'SET', 'DECLARE', 'BEGIN', 'COMMIT',
  'ROLLBACK', 'SAVE', 'TRANSACTION', 'UPDATETEXT', 'WRITETEXT',
]

/**
 * Por que a consulta não é somente leitura, ou null. Aceita um comando só, começando por SELECT ou WITH, sem palavras
 * que escrevem (INSERT, UPDATE, SELECT INTO...), executam (EXEC, procedures sp_/xp_) ou mudam a sessão (SET, USE).
 */
export function problemaDeSomenteLeitura(sql: string): string | null {
  const limpo = semTextos(sql).trim().replace(/;\s*$/, '')
  if (!limpo) return 'está sem consulta'
  if (limpo.includes(';')) return 'tem mais de um comando (só um SELECT por componente)'
  if (!/^(SELECT|WITH)\b/i.test(limpo)) return 'não começa com SELECT ou WITH (é somente leitura)'
  const palavra = limpo.match(new RegExp(`\\b(${PROIBIDAS.join('|')})\\b`, 'i'))
  if (palavra) return `não pode usar ${palavra[1].toUpperCase()} (é somente leitura)`
  const procedure = limpo.match(/\b(sp_|xp_)\w*/i)
  if (procedure) return `não pode chamar ${procedure[0]} (é somente leitura)`
  return null
}

/** Os @nome usados na consulta (sem as variáveis do sistema, @@ROWCOUNT etc.). */
export function parametrosUsados(sql: string): string[] {
  return [...new Set([...semTextos(sql).matchAll(/(?<!@)@([A-Za-z_][A-Za-z0-9_]*)/g)].map(m => m[1]))]
}

const IDENTIFICADOR = /^[A-Za-z_][A-Za-z0-9_]*$/

export const sqlserver: ComponenteLogica = {
  tipo: 'sqlserver',
  entradas: ['envelope'],
  saidas: ['envelope'],

  validar(config) {
    const {conexao, sql, parametros} = configDoSqlServer(config)
    const pendencias: string[] = []
    if (!conexao.trim()) pendencias.push('está sem conexão (nome do segredo com a connection string).')
    const problema = problemaDeSomenteLeitura(sql)
    if (problema) pendencias.push(`${problema}.`)
    const nomes = new Set<string>()
    parametros.forEach((p, i) => {
      if (!IDENTIFICADOR.test(p.nome ?? '')) pendencias.push(`parâmetro ${i + 1} ${p.nome ? `"@${p.nome}" não é um nome válido` : 'está sem nome'}.`)
      else if (nomes.has(p.nome.toLowerCase())) pendencias.push(`tem o parâmetro "@${p.nome}" repetido.`)
      nomes.add((p.nome ?? '').toLowerCase())
    })
    for (const usado of parametrosUsados(sql)) {
      if (!nomes.has(usado.toLowerCase())) pendencias.push(`usa @${usado}, que não está nos parâmetros.`)
    }
    return pendencias
  },

  async* executar(entradas, config, ctx) {
    const {conexao, sql, parametros, tempoMaximoS} = configDoSqlServer(config)
    const problema = problemaDeSomenteLeitura(sql)
    if (problema) throw new Error(`A consulta ${problema}.`)
    let consultas = 0
    let linhas = 0
    for await (const doc of entradas['in-0'] ?? []) {
      consultas += 1
      const t0 = Date.now()
      let destaConsulta = 0
      try {
        const valores = Object.fromEntries(parametros.map(p => [p.nome, ctx.valorDoCampo(p, doc)]))
        // esperar o banco não é tempo ativo
        const consulta = ctx.consultarSql({segredo: conexao, sql, parametros: valores, tempoMaximoMs: tempoMaximoS * 1000})
        for await (const linha of ctx.esperarCada(consulta)) {
          destaConsulta += 1
          yield {porta: 'out-0', doc: mesclar(doc, linha, ctx.no.override)}
        }
        ctx.log('info', `Consulta ${consultas}: ${destaConsulta} linha(s) em ${Date.now() - t0} ms.`)
      } catch (e) {
        // as linhas que já saíram seguem; o envelope que disparou a consulta vai para a política de erro
        if (destaConsulta) ctx.log('aviso', `Consulta ${consultas} parou depois de ${destaConsulta} linha(s).`)
        yield {erro: comoErro(e), doc}
      }
      linhas += destaConsulta
    }
    ctx.log('info', `${linhas} linha(s) lidas em ${consultas} consulta(s).`)
  },
}
