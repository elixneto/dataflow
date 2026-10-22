import {mesclar, problemaNoNome} from '../envelope'
import type {ComponenteLogica, TipoDeParametro} from '../tipos'

/**
 * Data Grid (no Kettle, Data grid): tabela digitada no próprio componente. Para cada envelope que chega (em geral o
 * único que o Start solta), solta um envelope por linha, com as colunas gravadas no DATA (como o Mapper).
 * Serve para de-para (ligado na consulta do Lookup) e para testar um fluxo sem entrada.
 * As células ficam como texto na config e são convertidas pelo tipo da coluna; célula vazia vira null.
 */

export type ColunaDoDataGrid = {nome: string; tipo: TipoDeParametro}

export function configDoDataGrid(config: Record<string, unknown>) {
  const colunas = Array.isArray(config.colunas) ? (config.colunas as ColunaDoDataGrid[]) : []
  const linhas = Array.isArray(config.linhas) ? (config.linhas as string[][]) : []
  return {colunas, linhas}
}

const VERDADEIROS = ['true', 'sim', 's', '1']
const FALSOS = ['false', 'não', 'nao', 'n', '0']

/** Valor da célula no tipo da coluna; texto que não converte devolve undefined (vira pendência na validação). */
export function valorDaCelula(texto: string | undefined, tipo: TipoDeParametro): unknown {
  const t = (texto ?? '').trim()
  if (t === '') return null
  if (tipo === 'numero') {
    // aceita vírgula decimal (colado do Excel em pt-BR); ponto de milhar não
    const n = Number(t.replace(',', '.'))
    return Number.isFinite(n) ? n : undefined
  }
  if (tipo === 'booleano') {
    const v = t.toLowerCase()
    return VERDADEIROS.includes(v) ? true : FALSOS.includes(v) ? false : undefined
  }
  return texto
}

export const datagrid: ComponenteLogica = {
  tipo: 'datagrid',
  entradas: ['envelope'],
  saidas: ['envelope'],

  validar(config) {
    const {colunas, linhas} = configDoDataGrid(config)
    if (colunas.length === 0) return ['não tem nenhuma coluna.']
    const pendencias: string[] = []
    const vistos = new Set<string>()
    colunas.forEach((c, i) => {
      const problema = problemaNoNome(c.nome)
      if (problema) pendencias.push(`coluna ${i + 1} ${problema}.`)
      else if (vistos.has(c.nome)) pendencias.push(`tem a coluna "${c.nome}" repetida.`)
      vistos.add(c.nome)
    })
    if (linhas.length === 0) pendencias.push('não tem nenhuma linha.')
    linhas.forEach((linha, i) => colunas.forEach((c, j) => {
      if (valorDaCelula(linha[j], c.tipo) !== undefined) return
      pendencias.push(`linha ${i + 1}, coluna "${c.nome || j + 1}": "${linha[j]}" não é ${c.tipo === 'numero' ? 'número' : 'booleano'}.`)
    }))
    return pendencias
  },

  async* executar(entradas, config, ctx) {
    const {colunas, linhas} = configDoDataGrid(config)
    const registros = linhas.map(linha => Object.fromEntries(colunas.map((c, j) => [c.nome, valorDaCelula(linha[j], c.tipo) ?? null])))
    let entrou = 0
    for await (const doc of entradas['in-0'] ?? []) {
      entrou += 1
      for (const registro of registros) yield {porta: 'out-0', doc: mesclar(doc, registro, ctx.no.override)}
    }
    ctx.log('info', `${registros.length} linha(s) soltas para ${entrou} envelope(s) de entrada.`)
  },
}
