import type {ClipboardEvent} from 'react'
import {Plus, Table, X} from 'lucide-react'
import {configDoDataGrid, datagrid, valorDaCelula, type ColunaDoDataGrid, type TipoDeParametro} from '@dataflow/core'
import {CampoDaChave, inputCampo} from '@/ui/campo-expression'
import {cn} from '@/lib/utils'
import type {CamposProps, ComponenteDef} from './tipos'

// Parte visual do Data Grid. A lógica é a do core.

function CardDataGrid({config}: CamposProps) {
  const {colunas, linhas} = configDoDataGrid(config)
  if (colunas.length === 0) return <p className="text-xs italic text-muted-foreground">Nenhuma coluna</p>
  return (
    <div className="flex flex-col gap-1 font-mono text-xs">
      <p className="truncate font-semibold" title={colunas.map(c => c.nome).join(', ')}>{colunas.map(c => c.nome || '?').join(', ')}</p>
      <p className="text-muted-foreground">{linhas.length} linha(s)</p>
    </div>
  )
}

const TIPOS: [TipoDeParametro, string][] = [['texto', 'Texto'], ['numero', 'Número'], ['booleano', 'Booleano']]

/** Texto colado do Excel/planilha: linhas por quebra, colunas por tab. */
function lerColado(texto: string) {
  return texto.replace(/\r/g, '').replace(/\n$/, '').split('\n').map(l => l.split('\t'))
}

/**
 * Grade editável: cabeçalho com nome e tipo de cada coluna, uma linha por envelope. Colar várias células do Excel numa
 * célula preenche a partir dela (e cria linhas e colunas que faltarem); colar no nome de uma coluna usa a primeira
 * linha como nomes e o resto como as linhas da grade.
 */
function PainelDataGrid({config, setConfig}: CamposProps) {
  const {colunas, linhas} = configDoDataGrid(config)

  const setColunas = (novas: ColunaDoDataGrid[]) => setConfig('colunas', novas)
  const setLinhas = (novas: string[][]) => setConfig('linhas', novas)
  const alterarColuna = (j: number, mudanca: Partial<ColunaDoDataGrid>) => setColunas(colunas.map((c, k) => (k === j ? {...c, ...mudanca} : c)))
  const alterarCelula = (i: number, j: number, valor: string) =>
    setLinhas(linhas.map((l, k) => (k === i ? Array.from({length: colunas.length}, (_, m) => (m === j ? valor : l[m] ?? '')) : l)))
  const removerColuna = (j: number) => {
    setColunas(colunas.filter((_, k) => k !== j))
    setLinhas(linhas.map(l => l.filter((_, k) => k !== j)))
  }
  /** colunas que faltam para caber `qtd` a partir de `inicio` */
  const comColunas = (inicio: number, qtd: number) =>
    [...colunas, ...Array.from({length: Math.max(0, inicio + qtd - colunas.length)}, () => ({nome: '', tipo: 'texto' as const}))]

  function colarNaCelula(e: ClipboardEvent<HTMLInputElement>, i: number, j: number) {
    const texto = e.clipboardData.getData('text')
    if (!/[\t\n]/.test(texto.replace(/\r?\n$/, ''))) return
    e.preventDefault()
    const colado = lerColado(texto)
    const novasColunas = comColunas(j, Math.max(...colado.map(l => l.length)))
    const novasLinhas = [...linhas]
    colado.forEach((celulas, di) => {
      const linha = [...(novasLinhas[i + di] ?? [])]
      celulas.forEach((v, dj) => (linha[j + dj] = v))
      novasLinhas[i + di] = Array.from({length: novasColunas.length}, (_, m) => linha[m] ?? '')
    })
    setColunas(novasColunas)
    setLinhas(novasLinhas)
  }

  function colarNoCabecalho(e: ClipboardEvent<HTMLInputElement>, j: number) {
    const texto = e.clipboardData.getData('text')
    if (!/[\t\n]/.test(texto.replace(/\r?\n$/, ''))) return
    e.preventDefault()
    const [nomes, ...resto] = lerColado(texto)
    const novasColunas = comColunas(j, nomes.length).map((c, k) => (k >= j && k < j + nomes.length ? {...c, nome: nomes[k - j].trim()} : c))
    setColunas(novasColunas)
    if (resto.length) setLinhas(resto.map(celulas => Array.from({length: novasColunas.length}, (_, m) => (m >= j ? celulas[m - j] ?? '' : ''))))
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-auto rounded-md border border-border">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="w-8 border-b border-border"/>
              {colunas.map((c, j) => (
                <th key={j} className="min-w-40 border-b border-l border-border p-1.5 text-left font-normal">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1">
                      <CampoDaChave valor={c.nome} onValor={nome => alterarColuna(j, {nome})} rotulo={`Nome da coluna ${j + 1}`} placeholder="coluna"
                                    onPaste={e => colarNoCabecalho(e, j)}
                                    className="flex-1"/>
                      <button type="button" onClick={() => removerColuna(j)} aria-label={`Remover coluna ${j + 1}`}
                              className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                        <X className="size-4" aria-hidden="true"/>
                      </button>
                    </div>
                    <select value={c.tipo} onChange={e => alterarColuna(j, {tipo: e.target.value as TipoDeParametro})} aria-label={`Tipo da coluna ${j + 1}`}
                            className={cn(inputCampo, 'w-full')}>
                      {TIPOS.map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
                    </select>
                  </div>
                </th>
              ))}
              <th className="w-10 border-b border-l border-border p-1.5">
                <button type="button" onClick={() => {
                  setColunas([...colunas, {nome: '', tipo: 'texto'}])
                  setLinhas(linhas.map(l => [...l, '']))
                }} aria-label="Adicionar coluna" title="Adicionar coluna"
                        className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                  <Plus className="size-4" aria-hidden="true"/>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha, i) => (
              <tr key={i} className="border-b border-border last:border-b-0">
                <td className="text-center font-mono text-muted-foreground">{i + 1}</td>
                {colunas.map((c, j) => {
                  const invalido = valorDaCelula(linha[j], c.tipo) === undefined
                  return (
                    <td key={j} className="border-l border-border p-1">
                      <input value={linha[j] ?? ''} onChange={e => alterarCelula(i, j, e.target.value)} onPaste={e => colarNaCelula(e, i, j)}
                             aria-label={`Linha ${i + 1}, ${c.nome || `coluna ${j + 1}`}`} aria-invalid={invalido}
                             className={cn(inputCampo, c.tipo !== 'texto' && 'font-mono', c.tipo === 'numero' && 'text-right',
                               invalido && 'border-destructive focus-visible:border-destructive')}/>
                    </td>
                  )
                })}
                <td className="border-l border-border p-1">
                  <button type="button" onClick={() => setLinhas(linhas.filter((_, k) => k !== i))} aria-label={`Remover linha ${i + 1}`}
                          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                    <X className="size-4" aria-hidden="true"/>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {colunas.length > 0 && linhas.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">Nenhuma linha</p>}
      </div>
      {colunas.length > 0 && (
        <button type="button" onClick={() => setLinhas([...linhas, colunas.map(() => '')])}
                className="flex h-8 items-center justify-center gap-1 rounded-md border border-dashed border-input text-xs text-muted-foreground hover:border-ring hover:text-foreground">
          <Plus className="size-3.5" aria-hidden="true"/> Adicionar linha
        </button>
      )}
    </div>
  )
}

function DocumentacaoDataGrid() {
  return (
    <>
      <p>Tabela digitada no próprio componente: solta um envelope por linha, com cada coluna gravada no envelope (como o Mapper).</p>
      <p>Serve para de-para (ex.: código do sistema de origem → valor do destino, ligado na entrada <code>lookup</code> do Lookup) e para testar um fluxo sem precisar de entrada.</p>
      <h4>Entrada</h4>
      <p>1 porta de envelopes, em geral ligada no Start. Para cada envelope que chega, a grade inteira sai de novo: o Start solta um envelope, então saem tantos envelopes quantas são as linhas.</p>
      <h4>Saída</h4>
      <p>Um envelope por linha, com o DATA do envelope que chegou mais as colunas. Os próximos componentes leem cada coluna como <code>$coluna</code>.</p>
      <h4>Tipos</h4>
      <p>Texto vai como está. Número aceita vírgula decimal (<code>1,5</code>). Booleano aceita <code>true</code>/<code>false</code>, <code>sim</code>/<code>não</code> e <code>1</code>/<code>0</code>. Célula vazia vira <code>null</code>. Célula que não converte fica em vermelho e impede a execução.</p>
      <h4>Colar do Excel</h4>
      <p>Copie as células na planilha e cole numa célula da grade: preenche a partir dela e cria as linhas e colunas que faltarem. Colando no nome de uma coluna, a primeira linha vira os nomes das colunas e o resto, as linhas.</p>
      <h4>Override</h4>
      <p>Ligado, o envelope de saída leva só as colunas da grade.</p>
    </>
  )
}

export const DATA_GRID: ComponenteDef = {
  tipo: datagrid.tipo,
  rotulo: 'Data Grid',
  descricao: 'Tabela digitada que solta um envelope por linha',
  categoria: 'fonte',
  icone: Table,
  entradas: datagrid.entradas,
  saidas: datagrid.saidas,
  semErro: true,
  usaOverride: true,
  tamanhoDaJanela: {w: 760, h: 560},
  configPadrao: {colunas: [{nome: '', tipo: 'texto'}], linhas: [['']]},
  Card: CardDataGrid,
  Painel: PainelDataGrid,
  Documentacao: DocumentacaoDataGrid,
  validar: config => datagrid.validar(config),
}
