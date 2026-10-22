import sql from 'mssql'
import {problemaDeSomenteLeitura, type ConsultarSql} from '@dataflow/core'

/*
 * SQL Server Query: consulta somente leitura com o driver mssql (tedious), em streaming e com controle de vazão.
 * Somente leitura, além da checagem do core (só SELECT/WITH): a consulta roda dentro de uma transação que sempre
 * termina em rollback, e a conexão vai com ApplicationIntent=ReadOnly. O ideal é o login ter só db_datareader.
 */

/** Acima disso o banco pausa até o fluxo consumir; abaixo de RETOMAR, volta a mandar. */
const PAUSAR = 500
const RETOMAR = 100

/** Um pool por connection string, aberto na primeira consulta e reaproveitado entre execuções. */
const pools = new Map<string, Promise<sql.ConnectionPool>>()

function pool(conexao: string) {
  let p = pools.get(conexao)
  if (!p) {
    const config = sql.ConnectionPool.parseConnectionString(conexao)
    config.options = {...config.options, readOnlyIntent: true}
    p = new sql.ConnectionPool(config).connect()
    // conexão que falhou não fica no cache (a próxima tentativa abre de novo)
    p.catch(() => pools.delete(conexao))
    pools.set(conexao, p)
  }
  return p
}

/** Valor que cabe no envelope (JSON): data vira ISO, binário vira base64. */
function paraEnvelope(valor: unknown): unknown {
  if (valor instanceof Date) return valor.toISOString()
  if (Buffer.isBuffer(valor)) return valor.toString('base64')
  return valor
}

/** Erro do driver com uma mensagem que ajuda (sem a connection string). */
function mensagemDoErro(e: unknown): Error {
  const erro = e instanceof Error ? e : new Error(String(e))
  const codigo = (e as {code?: string})?.code
  if (codigo === 'ELOGIN') return Object.assign(new Error(`Login recusado pelo SQL Server: ${erro.message}`), {name: 'LoginError'})
  if (codigo === 'ESOCKET' || (codigo === 'ETIMEOUT' && /connect/i.test(erro.message))) {
    return Object.assign(new Error(`Não conectou no SQL Server: ${erro.message}`), {name: 'ConnectionError'})
  }
  if (codigo === 'ETIMEOUT') return Object.assign(new Error(`A consulta passou do tempo máximo: ${erro.message}`), {name: 'TimeoutError'})
  if (codigo === 'ECANCEL') return Object.assign(new Error('Consulta cancelada.'), {name: 'AbortError'})
  return erro
}

export const consultarSql: ConsultarSql = async function* ({conexao, sql: texto, parametros, tempoMaximoMs, sinal}) {
  const problema = problemaDeSomenteLeitura(texto)
  if (problema) throw new Error(`A consulta ${problema}.`)
  if (sinal.aborted) return

  let conectado: sql.ConnectionPool
  try {
    conectado = await pool(conexao)
  } catch (e) {
    throw mensagemDoErro(e)
  }

  const transacao = new sql.Transaction(conectado)
  await transacao.begin(sql.ISOLATION_LEVEL.READ_COMMITTED)
  const pedido = new sql.Request(transacao)
  pedido.stream = true
  for (const [nome, valor] of Object.entries(parametros)) pedido.input(nome, valor ?? null)

  // fila entre os eventos do driver e quem consome; pausa o banco quando enche
  const fila: Record<string, unknown>[] = []
  let terminou = false
  let erro: unknown
  let pausado = false
  let acordar: (() => void) | undefined
  const avisar = () => {
    const a = acordar
    acordar = undefined
    a?.()
  }

  pedido.on('row', (linha: Record<string, unknown>) => {
    const convertida: Record<string, unknown> = {}
    for (const [coluna, valor] of Object.entries(linha)) convertida[coluna] = paraEnvelope(valor)
    fila.push(convertida)
    if (!pausado && fila.length >= PAUSAR) {
      pausado = true
      pedido.pause()
    }
    avisar()
  })
  // o driver sempre termina com done (também depois de erro ou cancelamento): só então dá para fazer o rollback
  let concluido = false
  const fim = new Promise<void>(resolve => pedido.on('done', () => {
    concluido = true
    resolve()
  }))
  pedido.on('error', e => {
    erro ??= e
    avisar()
  })
  pedido.on('done', () => {
    terminou = true
    avisar()
  })
  const cancelar = () => pedido.cancel()
  sinal.addEventListener('abort', cancelar)
  const limite = setTimeout(() => {
    erro ??= Object.assign(new Error(`o limite deste componente é ${Math.round(tempoMaximoMs / 1000)} s.`), {code: 'ETIMEOUT'})
    pedido.cancel()
    avisar()
  }, tempoMaximoMs)

  pedido.query(texto)
  try {
    while (true) {
      // Parar: não solta o que ainda estava na fila
      if (sinal.aborted) return
      if (fila.length) {
        yield fila.shift()!
        if (pausado && fila.length <= RETOMAR) {
          pausado = false
          pedido.resume()
        }
        continue
      }
      if (erro) throw mensagemDoErro(erro)
      if (terminou || sinal.aborted) return
      await new Promise<void>(resolve => (acordar = resolve))
    }
  } finally {
    clearTimeout(limite)
    sinal.removeEventListener('abort', cancelar)
    // parou antes do fim (erro, cancelado, quem consumia desistiu): cancela o que falta no banco e espera o driver soltar
    if (!concluido) {
      if (pausado) pedido.resume()
      pedido.cancel()
      await Promise.race([fim, new Promise(r => setTimeout(r, 5_000))])
    }
    // somente leitura: nunca confirma nada
    await transacao.rollback().catch(() => {})
  }
}
