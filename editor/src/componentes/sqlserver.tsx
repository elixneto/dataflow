import {Database, Plus, X} from 'lucide-react'
import {configDoSqlServer, parametrosUsados, sqlserver, TEMPO_MAXIMO_PADRAO_DO_SQL_S, type ParametroDoSql} from '@dataflow/core'
import {CampoExpression, inputCampo} from '@/ui/campo-expression'
import {EditorDeCodigo} from '@/ui/editor-de-codigo'
import {cn} from '@/lib/utils'
import type {CamposProps, ComponenteDef} from './tipos'

// Parte visual do SQL Server Query. A lógica é a do core; quem fala com o banco é o runner.

function CardSqlServer({config}: CamposProps) {
  const {conexao, sql} = configDoSqlServer(config)
  const primeiraLinha = sql.trim().split('\n')[0] ?? ''
  return (
    <div className="flex flex-col gap-1 font-mono text-xs">
      <p className="truncate"><span className="text-muted-foreground">$SECRETS.</span><span className="font-semibold">{conexao || '?'}</span></p>
      {primeiraLinha
        ? <p className="truncate text-primary" title={sql}>{primeiraLinha}</p>
        : <p className="italic text-muted-foreground">Sem consulta</p>}
    </div>
  )
}

function PainelSqlServer({id, noId, config, setConfig}: CamposProps) {
  const {conexao, sql, parametros, tempoMaximoS} = configDoSqlServer(config)
  const alterar = (i: number, mudanca: Partial<ParametroDoSql>) => setConfig('parametros', parametros.map((p, j) => (j === i ? {...p, ...mudanca} : p)))
  const declarados = new Set(parametros.map(p => p.nome.toLowerCase()))
  const faltando = parametrosUsados(sql).filter(n => !declarados.has(n.toLowerCase()))

  return (
    <div className="flex min-h-[520px] flex-1 !shrink flex-col gap-4">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-3">
        <label htmlFor={`${id}-conexao`} className="text-xs font-medium text-muted-foreground">Conexão</label>
        <div className="flex min-w-0 items-center gap-1">
          <span className="font-mono text-sm text-muted-foreground" aria-hidden="true">$SECRETS.</span>
          <input id={`${id}-conexao`} value={conexao} onChange={e => setConfig('conexao', e.target.value)} placeholder="MEU_BANCO_SQL" spellCheck={false}
                 className={cn(inputCampo, 'font-mono')}/>
        </div>
        <label htmlFor={`${id}-tempo`} className="text-xs font-medium text-muted-foreground">Tempo máximo (s)</label>
        <input id={`${id}-tempo`} type="number" min={1} value={tempoMaximoS}
               onChange={e => setConfig('tempoMaximoS', Math.max(1, Math.round(Number(e.target.value) || TEMPO_MAXIMO_PADRAO_DO_SQL_S)))}
               className={cn(inputCampo, 'w-24 font-mono')}/>
      </div>

      <section className="flex min-h-[220px] flex-1 flex-col gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">Consulta</h3>
        <div className="relative min-h-[200px] flex-1">
          <EditorDeCodigo valor={sql} onValor={v => setConfig('sql', v)} caminho={noId} rotulo="Consulta SQL" linguagem="sql"/>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">Parâmetros</h3>
        <div className="flex flex-col overflow-hidden rounded-md border border-border">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_32px] items-center gap-x-1.5 border-b border-border bg-muted/50 px-2 py-1.5 text-xs font-medium text-muted-foreground">
            <span>Nome</span><span>Valor</span><span/>
          </div>
          {parametros.map((p, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_32px] items-center gap-x-1.5 border-b border-border px-2 py-1.5 last:border-b-0">
              <div className="flex min-w-0 items-center gap-1">
                <span className="font-mono text-sm text-muted-foreground" aria-hidden="true">@</span>
                <input value={p.nome} onChange={e => alterar(i, {nome: e.target.value})} placeholder="parametro" spellCheck={false}
                       aria-label={`Nome do parâmetro ${i + 1}`} className={cn(inputCampo, 'font-mono')}/>
              </div>
              <CampoExpression rotulo={`Valor do parâmetro ${i + 1}`} valor={p.valor} expression={p.expression}
                               onValor={valor => alterar(i, {valor})} onExpression={expression => alterar(i, {expression})}/>
              <button type="button" onClick={() => setConfig('parametros', parametros.filter((_, j) => j !== i))} aria-label={`Remover parâmetro ${i + 1}`}
                      className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                <X className="size-4" aria-hidden="true"/>
              </button>
            </div>
          ))}
          {parametros.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">Nenhum parâmetro</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setConfig('parametros', [...parametros, {nome: '', valor: '', expression: true}])}
                  className="flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-dashed border-input text-xs text-muted-foreground hover:border-ring hover:text-foreground">
            <Plus className="size-3.5" aria-hidden="true"/> Adicionar parâmetro
          </button>
          {faltando.length > 0 && (
            <button type="button" onClick={() => setConfig('parametros', [...parametros, ...faltando.map(nome => ({nome, valor: '', expression: true}))])}
                    className="flex h-8 items-center justify-center gap-1 rounded-md border border-input px-3 text-xs text-muted-foreground hover:border-ring hover:text-foreground">
              <Plus className="size-3.5" aria-hidden="true"/> Incluir {faltando.map(n => `@${n}`).join(', ')}
            </button>
          )}
        </div>
      </section>
    </div>
  )
}

function DocumentacaoSqlServer() {
  return (
    <>
      <p>Roda uma consulta no SQL Server e solta um envelope por linha, com as colunas gravadas no envelope. Ex.: ler os pedidos de um ERP.</p>
      <h4>Entrada</h4>
      <p>1 porta de envelopes, em geral ligada no Start. A consulta roda uma vez para cada envelope que chega (o Start solta um).</p>
      <h4>Saída</h4>
      <p>Um envelope por linha, com o <code>DATA</code> do envelope que chegou mais as colunas (<code>$coluna</code>). Datas vêm como texto ISO (<code>2026-10-21T18:00:00.000Z</code>), binários em base64. A leitura é em streaming: o banco pausa enquanto o fluxo não consome, então dá para ler milhões de linhas.</p>
      <h4>Conexão</h4>
      <p>O nome de um segredo (<code>$SECRETS</code>) com a connection string. Ela não fica no fluxo nem nos logs. Ex.: <code>Server=srv;Database=erp;User Id=leitura;Password=...;Encrypt=true;TrustServerCertificate=true</code>.</p>
      <h4>Parâmetros</h4>
      <p>Use <code>@nome</code> na consulta e diga o valor embaixo (texto ou expression no envelope que chegou, ex.: <code>$PARAMETERS.desde</code>). O valor vai para o banco como parâmetro, nunca colado no texto: não tem como virar SQL injection.</p>
      <pre>{`SELECT id, nome, codigoEmpresa
FROM Atendimento
WHERE data >= @desde`}</pre>
      <h4>Somente leitura</h4>
      <p>Só passa um comando, começando por <code>SELECT</code> ou <code>WITH</code>, sem <code>INSERT</code>, <code>UPDATE</code>, <code>DELETE</code>, <code>SELECT INTO</code>, <code>EXEC</code>, procedures etc. Mesmo assim, a consulta roda dentro de uma transação que sempre é desfeita, e a conexão vai com <code>ApplicationIntent=ReadOnly</code>. O ideal é o login do segredo ter só <code>db_datareader</code>.</p>
      <h4>Tempo máximo</h4>
      <p>Passou do tempo, a consulta é cancelada no banco e vira erro. O botão Parar também cancela.</p>
      <h4>Erros</h4>
      <p>Falha de conexão, login ou consulta é erro do envelope que disparou a consulta e segue a política "Em caso de erro" do card. Se a falha vier no meio da leitura, as linhas que já saíram seguem.</p>
      <h4>Override</h4>
      <p>Ligado, o envelope de saída leva só as colunas da consulta.</p>
    </>
  )
}

export const SQL_SERVER: ComponenteDef = {
  tipo: sqlserver.tipo,
  rotulo: 'SQL Server Query',
  descricao: 'Lê linhas do SQL Server (somente leitura)',
  categoria: 'fonte',
  icone: Database,
  entradas: sqlserver.entradas,
  saidas: sqlserver.saidas,
  usaOverride: true,
  tamanhoDaJanela: {w: 760, h: 680},
  configPadrao: {conexao: '', sql: 'SELECT TOP 100 *\nFROM ', parametros: [], tempoMaximoS: TEMPO_MAXIMO_PADRAO_DO_SQL_S},
  Card: CardSqlServer,
  Painel: PainelSqlServer,
  Documentacao: DocumentacaoSqlServer,
  validar: config => sqlserver.validar(config),
}
