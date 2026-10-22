import {expect, test} from 'bun:test'
import {executarWorkflow, type WorkflowParaExecutar} from '@dataflow/core'
import {avaliar} from './expressions'
import {prepararScript} from './scripts'

/** Start → (Aggregate, se tiver lote) → TypeScript → End */
const fluxo = (codigo: string, lote?: number, override = true): WorkflowParaExecutar => ({
  projeto: 'Teste', workflow: 'TypeScript', parametros: [{nome: 'sufixo', tipo: 'texto', padrao: '!'}],
  nos: [
    {id: 'inicio', tipo: 'inicio', rotulo: 'Start', config: {recebeEntrada: true}},
    ...(lote ? [{id: 'agg', tipo: 'aggregate', rotulo: 'Aggregate', config: {tamanho: lote}}] : []),
    {id: 'ts', tipo: 'typescript', rotulo: 'TypeScript', config: {codigo}, override, chaveDeSaida: 'calculo'},
    {id: 'fim', tipo: 'fim', rotulo: 'End', config: {}},
  ],
  ligacoes: [
    ...(lote
      ? [{origem: 'inicio', portaDeOrigem: 'out-0', destino: 'agg', portaDeDestino: 'in-0'}, {origem: 'agg', portaDeOrigem: 'out-0', destino: 'ts', portaDeDestino: 'in-0'}]
      : [{origem: 'inicio', portaDeOrigem: 'out-0', destino: 'ts', portaDeDestino: 'in-0'}]),
    {origem: 'ts', portaDeOrigem: 'out-0', destino: 'fim', portaDeDestino: 'in-0'},
  ],
})

const rodar = (codigo: string, entrada: unknown, lote?: number, override = true) =>
  executarWorkflow(fluxo(codigo, lote, override), {modo: 'execution', id: 't', avaliar, prepararScript, segredos: {token: 'abc'}, entrada})

test('process com tipos, função auxiliar, parâmetros e segredos', async () => {
  const r = await rodar(`
    type Pessoa = {nome: string}
    function maiusculo(texto: string): string { return texto.toUpperCase() }
    async function process($input: Pessoa) {
      log('processando', $input.nome)
      return {nome: maiusculo($input.nome) + $PARAMETERS.sufixo, token: $SECRETS.token}
    }`, [{nome: 'ana'}, {nome: 'bia'}])
  expect(r.status).toBe('concluida')
  const ts = r.componentes.find(c => c.noId === 'ts')!
  expect(ts.amostraDeSaida['out-0']).toEqual([{nome: 'ANA!', token: 'abc'}, {nome: 'BIA!', token: 'abc'}])
  expect(ts.logs.some(l => l.mensagem === 'processando ana')).toBe(true)
})

test('Aggregate antes: $input.items é o lote e o retorno pode virar vários envelopes ou nenhum', async () => {
  const r = await rodar(`
    async function process($input: {items: {n: number}[]}) {
      const pares = $input.items.filter(i => i.n % 2 === 0)
      return pares.length ? pares.map(i => ({n: i.n, lote: $input.items.length})) : null
    }`, Array.from({length: 7}, (_, n) => ({n})), 3)
  expect(r.status).toBe('concluida')
  const ts = r.componentes.find(c => c.noId === 'ts')!
  expect(ts.amostraDeSaida['out-0']).toEqual([{n: 0, lote: 3}, {n: 2, lote: 3}, {n: 4, lote: 3}, {n: 6, lote: 1}])
  expect(ts.logs.at(-1)!.mensagem).toBe('3 envelope(s) entraram e 4 saíram.')
  expect(r.componentes.find(c => c.noId === 'agg')!.saidas['out-0']).toBe(3)
})

test('erro de compilação, exceção e loop infinito', async () => {
  expect((await rodar('async function process($input) { return {', [{}])).status).toBe('falhou')
  const comExcecao = await rodar('async function process($input) { throw new TypeError("ruim") }', [{}])
  expect(comExcecao.erro).toContain('ruim')
  const comLoop = await rodar('async function process($input) { while (true) {} }', [{}])
  expect(comLoop.status).toBe('falhou')
}, 20_000)

test('sem Override, o retorno vai para a chave de saída e o resto do DATA segue', async () => {
  const r = await rodar('async function process($input) { return $input.a * 2 }', [{a: 1, b: 'x'}, {a: 5, b: 'y'}], undefined, false)
  expect(r.status).toBe('concluida')
  expect(r.componentes.find(c => c.noId === 'ts')!.amostraDeSaida['out-0']).toEqual([{a: 1, b: 'x', calculo: 2}, {a: 5, b: 'y', calculo: 10}])
})
