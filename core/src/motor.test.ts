import {describe, expect, test} from 'bun:test'
import vm from 'node:vm'
import {COMPONENTES, executarWorkflow, parametrosUsados, portasCompativeis, problemaDeSomenteLeitura} from './index'
import type {WorkflowParaExecutar} from './index'

const avaliar = (expr: string, vars: Record<string, unknown>) => vm.runInNewContext(`(${expr})`, {...vars}, {timeout: 200})

const wf: WorkflowParaExecutar = {
  projeto: 'Teste', workflow: 'Concatenar',
  parametros: [{nome: 'prefixo', tipo: 'texto', padrao: 'IMP'}],
  nos: [
    {id: 'inicio', tipo: 'inicio', rotulo: 'Start', config: {}},
    {id: 'm', tipo: 'mapper', rotulo: 'Mapper', chaveDeSaida: 'codigo', config: {campos: [
      {destino: 'valor', valor: '`${$PARAMETERS.prefixo}-${$WORKFLOW_CURRENT_RUN.startedAt}`', expression: true},
      {destino: 'fixo', valor: 'texto puro', expression: false},
    ]}},
    {id: 'fim', tipo: 'fim', rotulo: 'End', config: {}},
  ],
  ligacoes: [
    {origem: 'inicio', portaDeOrigem: 'out-0', destino: 'm', portaDeDestino: 'in-0'},
    {origem: 'm', portaDeOrigem: 'out-0', destino: 'fim', portaDeDestino: 'in-0'},
  ],
}

test('mapper concatena parâmetro com o startedAt', async () => {
  const r = await executarWorkflow(wf, {modo: 'validation', id: 'teste', avaliar, valoresDosParametros: {prefixo: 'ABC'}})
  expect(r.status).toBe('concluida')
  const m = r.componentes.find(c => c.noId === 'm')!
  expect(m.entradas['in-0']).toBe(1)
  expect(m.saidas['out-0']).toBe(1)
  const saida = m.amostraDeSaida['out-0'][0] as {valor: string; fixo: string}
  expect(saida.valor).toBe(`ABC-${r.run.startedAt}`)
  expect(saida.fixo).toBe('texto puro')
  expect(r.componentes.find(c => c.noId === 'fim')!.entradas['in-0']).toBe(1)
})

test('expression com erro para a execução (política padrão)', async () => {
  const comErro = structuredClone(wf)
  comErro.nos[1].config = {campos: [{destino: 'x', valor: '$naoExiste.y', expression: true}]}
  const r = await executarWorkflow(comErro, {modo: 'execution', id: 't2', avaliar})
  expect(r.status).toBe('falhou')
  expect(r.componentes.find(c => c.noId === 'm')!.status).toBe('falhou')
})

test('registro vem na ordem do fluxo, não na ordem dos nós', async () => {
  const embaralhado = {...wf, nos: [wf.nos[2], wf.nos[1], wf.nos[0]]}
  const r = await executarWorkflow(embaralhado, {modo: 'validation', id: 't3', avaliar})
  expect(r.componentes.map(c => c.noId)).toEqual(['inicio', 'm', 'fim'])
})

test('mapper grava direto no envelope e o próximo enxerga', async () => {
  const doisMappers: WorkflowParaExecutar = {
    projeto: 'Teste', workflow: 'Dois mappers', parametros: [],
    nos: [
      {id: 'inicio', tipo: 'inicio', rotulo: 'Start', config: {}},
      {id: 'm1', tipo: 'mapper', rotulo: 'Mapper 1', config: {campos: [{destino: 'campo', valor: 'ABACAXI', expression: false}]}},
      {id: 'm2', tipo: 'mapper', rotulo: 'Mapper 2', config: {campos: [{destino: 'outroCampo', valor: '$campo + " 123"', expression: true}]}},
      {id: 'fim', tipo: 'fim', rotulo: 'End', config: {}},
    ],
    ligacoes: [
      {origem: 'inicio', portaDeOrigem: 'out-0', destino: 'm1', portaDeDestino: 'in-0'},
      {origem: 'm1', portaDeOrigem: 'out-0', destino: 'm2', portaDeDestino: 'in-0'},
      {origem: 'm2', portaDeOrigem: 'out-0', destino: 'fim', portaDeDestino: 'in-0'},
    ],
  }
  const r = await executarWorkflow(doisMappers, {modo: 'validation', id: 't4', avaliar})
  expect(r.status).toBe('concluida')
  expect(r.componentes.find(c => c.noId === 'm2')!.amostraDeSaida['out-0'][0]).toEqual({campo: 'ABACAXI', outroCampo: 'ABACAXI 123'})

  // Override no segundo: só o que ele mapeou
  doisMappers.nos[2].override = true
  const r2 = await executarWorkflow(doisMappers, {modo: 'validation', id: 't5', avaliar})
  expect(r2.componentes.find(c => c.noId === 'm2')!.amostraDeSaida['out-0'][0]).toEqual({outroCampo: 'ABACAXI 123'})
})

test('Início que recebe entrada põe o corpo no envelope; sem a opção, dá erro', async () => {
  const comEntrada = structuredClone(wf)
  comEntrada.nos[0].config = {recebeEntrada: true}
  comEntrada.nos[1].config = {campos: [{destino: 'saudacao', valor: '"Olá " + $nome', expression: true}]}
  const r = await executarWorkflow(comEntrada, {modo: 'validation', id: 't6', avaliar, entrada: {nome: 'Élix'}})
  expect(r.status).toBe('concluida')
  expect(r.componentes.find(c => c.noId === 'm')!.amostraDeSaida['out-0'][0]).toEqual({nome: 'Élix', saudacao: 'Olá Élix'})

  const semOpcao = await executarWorkflow(wf, {modo: 'validation', id: 't7', avaliar, entrada: {nome: 'x'}})
  expect(semOpcao.status).toBe('falhou')
  expect(semOpcao.erro).toContain('não recebe entrada')
})

test('entrada em array dispara um envelope por item', async () => {
  const comEntrada = structuredClone(wf)
  comEntrada.nos[0].config = {recebeEntrada: true}
  comEntrada.nos[1].config = {campos: [{destino: 'saudacao', valor: '"Olá " + $nome', expression: true}]}
  const r = await executarWorkflow(comEntrada, {modo: 'validation', id: 't8', avaliar, entrada: [{nome: 'Élix 1'}, {nome: 'Élix 2'}]})
  expect(r.status).toBe('concluida')
  const inicio = r.componentes.find(c => c.noId === 'inicio')!
  expect(inicio.entradas['in-0']).toBe(2)
  expect(inicio.saidas['out-0']).toBe(2)
  const m = r.componentes.find(c => c.noId === 'm')!
  expect(m.amostraDeSaida['out-0']).toEqual([{nome: 'Élix 1', saudacao: 'Olá Élix 1'}, {nome: 'Élix 2', saudacao: 'Olá Élix 2'}])
  expect(r.componentes.find(c => c.noId === 'fim')!.entradas['in-0']).toBe(2)
})

test('compatibilidade das portas', () => {
  expect(portasCompativeis('envelope', 'envelope')).toBe(true)
  expect(portasCompativeis('envelope', 'texto')).toBe(false)
  expect(portasCompativeis('texto', 'qualquer')).toBe(true)
  expect(portasCompativeis('qualquer', 'numero')).toBe(true)
})

test('Continuar: com erro, o envelope que entrou segue sem mudança', async () => {
  const comErro = structuredClone(wf)
  comErro.nos[0].config = {recebeEntrada: true}
  comErro.nos[1].config = {seErro: 'continuar', campos: [{destino: 'x', valor: '$naoExiste.y', expression: true}]}
  const r = await executarWorkflow(comErro, {modo: 'validation', id: 't9', avaliar, entrada: [{nome: 'A'}, {nome: 'B'}]})
  expect(r.status).toBe('com-erros')
  const m = r.componentes.find(c => c.noId === 'm')!
  expect(m.status).toBe('com-erros')
  expect(m.saidas['out-0']).toBe(2)
  expect(m.amostraDeSaida['out-0']).toEqual([{nome: 'A'}, {nome: 'B'}])
  expect(m.logs.filter(l => l.nivel === 'erro')).toHaveLength(2)
  expect(r.componentes.find(c => c.noId === 'fim')!.entradas['in-0']).toBe(2)
})

test('desativado com saída solta: bypass, envelope descartado e nada no Fim viram avisos', async () => {
  const solto: WorkflowParaExecutar = {
    projeto: 'Teste', workflow: 'Solto', parametros: [],
    nos: [
      {id: 'inicio', tipo: 'inicio', rotulo: 'Start', config: {}},
      {id: 'm1', tipo: 'mapper', rotulo: 'Mapper 1', desativado: true, config: {seErro: 'desviar', campos: [{destino: 'x', valor: 'a', expression: true}]}},
      {id: 'm2', tipo: 'mapper', rotulo: 'Mapper 2', config: {campos: [{destino: 'status', valor: 'ERR', expression: false}]}},
      {id: 'fim', tipo: 'fim', rotulo: 'End', config: {}},
    ],
    ligacoes: [
      {origem: 'inicio', portaDeOrigem: 'out-0', destino: 'm1', portaDeDestino: 'in-0'},
      {origem: 'm1', portaDeOrigem: 'erro', destino: 'm2', portaDeDestino: 'in-0'},
      {origem: 'm2', portaDeOrigem: 'out-0', destino: 'fim', portaDeDestino: 'in-0'},
    ],
  }
  const r = await executarWorkflow(solto, {modo: 'execution', id: 't10', avaliar})
  const m1 = r.componentes.find(c => c.noId === 'm1')!
  expect(m1.status).toBe('desativado')
  expect(m1.logs.some(l => l.mensagem.includes('descartado'))).toBe(true)
  expect(r.componentes.find(c => c.noId === 'fim')!.status).toBe('com-avisos')
  expect(r.status).toBe('com-avisos')
})

function fluxoComUnir(): WorkflowParaExecutar {
  return {
    projeto: 'Teste', workflow: 'Union', parametros: [],
    nos: [
      {id: 'inicio', tipo: 'inicio', rotulo: 'Start', config: {recebeEntrada: true}},
      {id: 'ok', tipo: 'mapper', rotulo: 'Mapper', config: {seErro: 'desviar', campos: [{destino: 'dobro', valor: '$n * 2 + $falha.x', expression: true}]}},
      {id: 'trata', tipo: 'mapper', rotulo: 'Trata erro', config: {campos: [{destino: 'status', valor: 'ERRO', expression: false}]}},
      {id: 'unir', tipo: 'union', rotulo: 'Union', config: {qtdEntradas: 2}},
      {id: 'fim', tipo: 'fim', rotulo: 'End', config: {}},
    ],
    ligacoes: [
      {origem: 'inicio', portaDeOrigem: 'out-0', destino: 'ok', portaDeDestino: 'in-0'},
      {origem: 'ok', portaDeOrigem: 'out-0', destino: 'unir', portaDeDestino: 'in-0'},
      {origem: 'ok', portaDeOrigem: 'erro', destino: 'trata', portaDeDestino: 'in-0'},
      {origem: 'trata', portaDeOrigem: 'out-0', destino: 'unir', portaDeDestino: 'in-1'},
      {origem: 'unir', portaDeOrigem: 'out-0', destino: 'fim', portaDeDestino: 'in-0'},
    ],
  }
}

test('Unir junta a saída normal e a do tratamento de erro', async () => {
  const wfUnir = fluxoComUnir()
  // $falha só existe no 2º envelope: o 1º dá erro (vai para "trata"), o 2º passa
  const r = await executarWorkflow(wfUnir, {modo: 'execution', id: 't11', avaliar, entrada: [{n: 1}, {n: 2, falha: {x: 0}}]})
  const unido = r.componentes.find(c => c.noId === 'unir')!
  expect(unido.entradas).toEqual({'in-0': 1, 'in-1': 1})
  expect(unido.saidas['out-0']).toBe(2)
  expect(r.componentes.find(c => c.noId === 'fim')!.entradas['in-0']).toBe(2)
  // o que sai pela porta de erro leva DATA.errors (em inglês)
  expect(r.componentes.find(c => c.noId === 'trata')!.amostraDeEntrada[0].errors).toEqual([
    {error: 'ReferenceError', message: expect.stringContaining('$falha is not defined'), component: 'Mapper'},
  ])
  // o erro foi desviado e tratado: a execução é sucesso
  expect(r.componentes.find(c => c.noId === 'ok')!.status).toBe('concluido')
  expect(r.status).toBe('concluida')
})

test('ciclo nas ligações não executa (loop infinito)', async () => {
  const comCiclo: WorkflowParaExecutar = {
    projeto: 'Teste', workflow: 'Ciclo', parametros: [],
    nos: [
      {id: 'inicio', tipo: 'inicio', rotulo: 'Start', config: {}},
      {id: 'unir', tipo: 'union', rotulo: 'Union', config: {qtdEntradas: 2}},
      {id: 'm1', tipo: 'mapper', rotulo: 'Mapper 1', config: {seErro: 'desviar', campos: [{destino: 'x', valor: '$y.z', expression: true}]}},
      {id: 'm2', tipo: 'mapper', rotulo: 'Mapper 2', config: {campos: [{destino: 's', valor: 'ERRO', expression: false}]}},
      {id: 'fim', tipo: 'fim', rotulo: 'End', config: {}},
    ],
    ligacoes: [
      {origem: 'inicio', portaDeOrigem: 'out-0', destino: 'unir', portaDeDestino: 'in-0'},
      {origem: 'unir', portaDeOrigem: 'out-0', destino: 'm1', portaDeDestino: 'in-0'},
      {origem: 'm1', portaDeOrigem: 'out-0', destino: 'fim', portaDeDestino: 'in-0'},
      {origem: 'm1', portaDeOrigem: 'erro', destino: 'm2', portaDeDestino: 'in-0'},
      {origem: 'm2', portaDeOrigem: 'out-0', destino: 'unir', portaDeDestino: 'in-1'},
    ],
  }
  const r = await executarWorkflow(comCiclo, {modo: 'execution', id: 't13', avaliar})
  expect(r.status).toBe('falhou')
  expect(r.erro).toContain('Union → Mapper 1 → Mapper 2 → Union')
})

test('execução cancelada pelo sinal', async () => {
  const controle = new AbortController()
  controle.abort()
  const r = await executarWorkflow(wf, {modo: 'execution', id: 't14', avaliar, sinal: controle.signal})
  expect(r.status).toBe('falhou')
  expect(r.erro).toBe('Execução cancelada.')
})

test('Filter manda cada envelope para true ou false pela condição', async () => {
  const comFilter: WorkflowParaExecutar = {
    projeto: 'Teste', workflow: 'Filter', parametros: [],
    nos: [
      {id: 'inicio', tipo: 'inicio', rotulo: 'Start', config: {recebeEntrada: true}},
      {id: 'f', tipo: 'filter', rotulo: 'Filter', config: {condicao: '$preco > 10'}},
      {id: 'u', tipo: 'union', rotulo: 'Union', config: {qtdEntradas: 2}},
      {id: 'fim', tipo: 'fim', rotulo: 'End', config: {}},
    ],
    ligacoes: [
      {origem: 'inicio', portaDeOrigem: 'out-0', destino: 'f', portaDeDestino: 'in-0'},
      {origem: 'f', portaDeOrigem: 'out-0', destino: 'u', portaDeDestino: 'in-0'},
      {origem: 'f', portaDeOrigem: 'out-1', destino: 'u', portaDeDestino: 'in-1'},
      {origem: 'u', portaDeOrigem: 'out-0', destino: 'fim', portaDeDestino: 'in-0'},
    ],
  }
  const entrada = [{preco: 5}, {preco: 20}, {preco: 30}, {preco: 0}, {preco: 11}]
  const r = await executarWorkflow(comFilter, {modo: 'execution', id: 'tf', avaliar, entrada})
  expect(r.status).toBe('concluida')
  const f = r.componentes.find(c => c.noId === 'f')!
  expect(f.saidas).toEqual({'out-0': 3, 'out-1': 2})
  expect(f.amostraDeSaida['out-1']).toEqual([{preco: 5}, {preco: 0}])

  // condição que falha é erro do envelope (política padrão: interromper)
  comFilter.nos[1].config = {condicao: '$naoExiste > 1'}
  const comErro = await executarWorkflow(comFilter, {modo: 'execution', id: 'tf2', avaliar, entrada})
  expect(comErro.status).toBe('falhou')
})

test('Filter com a false sem ligação descarta sem aviso', async () => {
  const soTrue: WorkflowParaExecutar = {
    projeto: 'Teste', workflow: 'Filter só true', parametros: [],
    nos: [
      {id: 'inicio', tipo: 'inicio', rotulo: 'Start', config: {recebeEntrada: true}},
      {id: 'f', tipo: 'filter', rotulo: 'Filter', config: {condicao: '$preco > 10'}},
      {id: 'fim', tipo: 'fim', rotulo: 'End', config: {}},
    ],
    ligacoes: [
      {origem: 'inicio', portaDeOrigem: 'out-0', destino: 'f', portaDeDestino: 'in-0'},
      {origem: 'f', portaDeOrigem: 'out-0', destino: 'fim', portaDeDestino: 'in-0'},
    ],
  }
  const r = await executarWorkflow(soTrue, {modo: 'execution', id: 'tf3', avaliar, entrada: [{preco: 5}, {preco: 20}]})
  expect(r.status).toBe('concluida')
  expect(r.componentes.find(c => c.noId === 'f')!.status).toBe('concluido')
  expect(r.componentes.find(c => c.noId === 'fim')!.entradas['in-0']).toBe(1)
})

test('Router manda cada envelope para o primeiro caso verdadeiro ou para o else', async () => {
  const comRouter: WorkflowParaExecutar = {
    projeto: 'Teste', workflow: 'Router', parametros: [],
    nos: [
      {id: 'inicio', tipo: 'inicio', rotulo: 'Start', config: {recebeEntrada: true}},
      {id: 'r', tipo: 'router', rotulo: 'Router', config: {casos: [
        {rotulo: 'SP', condicao: '$uf === "SP"'},
        {rotulo: 'Sul', condicao: '["PR", "SC", "RS"].includes($uf)'},
      ]}},
      {id: 'u', tipo: 'union', rotulo: 'Union', config: {qtdEntradas: 2}},
      {id: 'fim', tipo: 'fim', rotulo: 'End', config: {}},
    ],
    ligacoes: [
      {origem: 'inicio', portaDeOrigem: 'out-0', destino: 'r', portaDeDestino: 'in-0'},
      {origem: 'r', portaDeOrigem: 'out-0', destino: 'u', portaDeDestino: 'in-0'},
      {origem: 'r', portaDeOrigem: 'out-1', destino: 'u', portaDeDestino: 'in-1'},
      // else (out-2) sem ligação: descarta sem aviso
      {origem: 'u', portaDeOrigem: 'out-0', destino: 'fim', portaDeDestino: 'in-0'},
    ],
  }
  const entrada = [{uf: 'SP'}, {uf: 'RS'}, {uf: 'BA'}, {uf: 'SC'}, {uf: 'SP'}]
  const r = await executarWorkflow(comRouter, {modo: 'execution', id: 'tr', avaliar, entrada})
  expect(r.status).toBe('concluida')
  const router = r.componentes.find(c => c.noId === 'r')!
  expect(router.status).toBe('concluido')
  expect(router.saidas).toEqual({'out-0': 2, 'out-1': 2, 'out-2': 1})
  expect(r.componentes.find(c => c.noId === 'fim')!.entradas['in-0']).toBe(4)
})

test('End aceita várias ligações na mesma entrada', async () => {
  const doisCaminhos: WorkflowParaExecutar = {
    projeto: 'Teste', workflow: 'End com várias ligações', parametros: [],
    nos: [
      {id: 'inicio', tipo: 'inicio', rotulo: 'Start', config: {recebeEntrada: true}},
      {id: 'f', tipo: 'filter', rotulo: 'Filter', config: {condicao: '$n > 2'}},
      {id: 'fim', tipo: 'fim', rotulo: 'End', config: {}},
    ],
    ligacoes: [
      {origem: 'inicio', portaDeOrigem: 'out-0', destino: 'f', portaDeDestino: 'in-0'},
      {origem: 'f', portaDeOrigem: 'out-0', destino: 'fim', portaDeDestino: 'in-0'},
      {origem: 'f', portaDeOrigem: 'out-1', destino: 'fim', portaDeDestino: 'in-0'},
    ],
  }
  const entrada = Array.from({length: 100}, (_, i) => ({n: i}))
  const r = await executarWorkflow(doisCaminhos, {modo: 'execution', id: 'te', avaliar, entrada})
  expect(r.status).toBe('concluida')
  expect(r.componentes.find(c => c.noId === 'fim')!.entradas['in-0']).toBe(100)
})

test('Lookup grava o envelope achado na chave de saída (null quando não acha) e o Mapper escolhe os campos', async () => {
  // as duas entradas vêm do mesmo Router: a principal não pode travar esperando a consulta terminar
  const comLookup: WorkflowParaExecutar = {
    projeto: 'Teste', workflow: 'Lookup', parametros: [],
    nos: [
      {id: 'inicio', tipo: 'inicio', rotulo: 'Start', config: {recebeEntrada: true}},
      {id: 'r', tipo: 'router', rotulo: 'Router', config: {casos: [{rotulo: 'empresa', condicao: '$tipo === "empresa"'}]}},
      {id: 'l', tipo: 'lookup', rotulo: 'Lookup', chaveDeSaida: 'empresa', config: {chaves: [{principal: '$codigoEmpresa', consulta: '$codigo'}]}},
      {id: 'm', tipo: 'mapper', rotulo: 'Mapper', config: {campos: [
        {destino: 'empresaId', valor: '$empresa?.id ?? null', expression: true},
        {destino: 'nomeDaEmpresa', valor: '$empresa?.nome ?? "(sem empresa)"', expression: true},
      ]}},
      {id: 'fim', tipo: 'fim', rotulo: 'End', config: {}},
    ],
    ligacoes: [
      {origem: 'inicio', portaDeOrigem: 'out-0', destino: 'r', portaDeDestino: 'in-0'},
      {origem: 'r', portaDeOrigem: 'out-1', destino: 'l', portaDeDestino: 'in-0'},
      {origem: 'r', portaDeOrigem: 'out-0', destino: 'l', portaDeDestino: 'in-1'},
      {origem: 'l', portaDeOrigem: 'out-0', destino: 'm', portaDeDestino: 'in-0'},
      {origem: 'm', portaDeOrigem: 'out-0', destino: 'fim', portaDeDestino: 'in-0'},
    ],
  }
  const atendimentos = Array.from({length: 200}, (_, i) => ({tipo: 'atendimento', id: i, codigoEmpresa: i % 3 === 2 ? 99 : String(i % 3)}))
  const empresas = [{tipo: 'empresa', codigo: 0, id: 'A', nome: 'Alfa'}, {tipo: 'empresa', codigo: 1, id: 'B', nome: 'Beta'}]
  const r = await executarWorkflow(comLookup, {modo: 'execution', id: 'tl', avaliar, entrada: [...atendimentos, ...empresas]})
  expect(r.status).toBe('concluida')
  const l = r.componentes.find(c => c.noId === 'l')!
  expect(l.saidas['out-0']).toBe(200)
  const amostra = l.amostraDeSaida['out-0'] as {empresa: {id: string} | null}[]
  expect(amostra.slice(0, 3).map(a => a.empresa?.id ?? null)).toEqual(['A', 'B', null])
  const mapeados = r.componentes.find(c => c.noId === 'm')!.amostraDeSaida['out-0'] as {empresaId: unknown; nomeDaEmpresa: string}[]
  expect(mapeados.slice(0, 3).map(a => [a.empresaId, a.nomeDaEmpresa])).toEqual([['A', 'Alfa'], ['B', 'Beta'], [null, '(sem empresa)']])

  // com Override, o DATA vira só o envelope achado
  comLookup.nos[2].override = true
  comLookup.nos[3].config = {campos: [{destino: 'x', valor: '1', expression: false}]}
  const soAchado = await executarWorkflow(comLookup, {modo: 'execution', id: 'tlo', avaliar, entrada: [...atendimentos, ...empresas]})
  expect(soAchado.componentes.find(c => c.noId === 'l')!.amostraDeSaida['out-0'].slice(0, 3))
    .toEqual([{tipo: 'empresa', codigo: 0, id: 'A', nome: 'Alfa'}, {tipo: 'empresa', codigo: 1, id: 'B', nome: 'Beta'}, {}])
  comLookup.nos[2].override = false

  // sem par vira erro do envelope com "erro"
  comLookup.nos[2].config = {...comLookup.nos[2].config, seNaoEncontrar: 'erro'}
  const comErro = await executarWorkflow(comLookup, {modo: 'execution', id: 'tl2', avaliar, entrada: [...atendimentos, ...empresas]})
  expect(comErro.status).toBe('falhou')
})

test('tempo ativo não conta a espera, e o Aggregate informa o pico do lote', async () => {
  const lento: WorkflowParaExecutar = {
    projeto: 'Teste', workflow: 'Métricas', parametros: [],
    nos: [
      {id: 'inicio', tipo: 'inicio', rotulo: 'Start', config: {recebeEntrada: true}},
      {id: 'ts', tipo: 'typescript', rotulo: 'Lento', override: true, config: {codigo: 'async function process($input) {}'}},
      {id: 'm', tipo: 'mapper', rotulo: 'Mapper', config: {campos: [{destino: 'b', valor: '$a * 2', expression: true}]}},
      {id: 'ag', tipo: 'aggregate', rotulo: 'Aggregate', config: {tamanho: 4}},
      {id: 'fim', tipo: 'fim', rotulo: 'End', config: {}},
    ],
    ligacoes: [
      {origem: 'inicio', portaDeOrigem: 'out-0', destino: 'ts', portaDeDestino: 'in-0'},
      {origem: 'ts', portaDeOrigem: 'out-0', destino: 'm', portaDeDestino: 'in-0'},
      {origem: 'm', portaDeOrigem: 'out-0', destino: 'ag', portaDeDestino: 'in-0'},
      {origem: 'ag', portaDeOrigem: 'out-0', destino: 'fim', portaDeDestino: 'in-0'},
    ],
  }
  // o "script" espera 30 ms por envelope (como uma chamada HTTP) e devolve o próprio DATA
  const prepararScript = async () => async (input: unknown) => {
    await new Promise(r => setTimeout(r, 30))
    return input
  }
  const r = await executarWorkflow(lento, {
    modo: 'execution', id: 'metricas', avaliar, prepararScript, entrada: Array.from({length: 6}, (_, i) => ({a: i})),
  })
  expect(r.status).toBe('concluida')
  const porId = (id: string) => r.componentes.find(c => c.noId === id)!
  // o script aguarda por dentro: conta como ativo
  expect(porId('ts').tempoAtivoMs!).toBeGreaterThan(150)
  // o Mapper passou a execução esperando o script: fica ativo bem menos do que durou
  expect(porId('m').duracaoMs!).toBeGreaterThan(100)
  expect(porId('m').tempoAtivoMs!).toBeLessThan(porId('m').duracaoMs! / 2)
  expect(porId('ag').memoria?.picoDeEnvelopes).toBe(4)
  // pico × tamanho médio do JSON do DATA ({"a":0,"b":0} tem 13; com b = 10, 14)
  expect(porId('ag').memoria!.picoDeBytes).toBeGreaterThanOrEqual(4 * 13)
  expect(porId('ag').memoria!.picoDeBytes).toBeLessThanOrEqual(4 * 14)
  // quem não guarda nada fica sem memória
  expect(porId('m').memoria).toBeUndefined()
})

test('data grid solta um envelope por linha, com as colunas convertidas pelo tipo', async () => {
  const grid: WorkflowParaExecutar = {
    projeto: 'Teste', workflow: 'Data Grid', parametros: [],
    nos: [
      {id: 'inicio', tipo: 'inicio', rotulo: 'Start', config: {}},
      {id: 'g', tipo: 'datagrid', rotulo: 'Data Grid', config: {
        colunas: [{nome: 'codigo', tipo: 'texto'}, {nome: 'peso', tipo: 'numero'}, {nome: 'ativo', tipo: 'booleano'}],
        linhas: [['A1', '1,5', 'sim'], ['B2', '', 'false']],
      }},
      {id: 'fim', tipo: 'fim', rotulo: 'End', config: {}},
    ],
    ligacoes: [
      {origem: 'inicio', portaDeOrigem: 'out-0', destino: 'g', portaDeDestino: 'in-0'},
      {origem: 'g', portaDeOrigem: 'out-0', destino: 'fim', portaDeDestino: 'in-0'},
    ],
  }
  const r = await executarWorkflow(grid, {modo: 'execution', id: 'grid', avaliar})
  expect(r.status).toBe('concluida')
  expect(r.componentes.find(c => c.noId === 'g')!.amostraDeSaida['out-0']).toEqual([
    {codigo: 'A1', peso: 1.5, ativo: true},
    {codigo: 'B2', peso: null, ativo: false},
  ])
})

test('data grid acusa célula que não converte e coluna sem nome', () => {
  const config = {colunas: [{nome: 'n', tipo: 'numero'}, {nome: '', tipo: 'texto'}], linhas: [['abc', 'x']]}
  const pendencias = COMPONENTES.datagrid.validar(config)
  expect(pendencias.some(p => p.includes('"abc" não é número'))).toBe(true)
  expect(pendencias.some(p => p.startsWith('coluna 2'))).toBe(true)
})

test('copy manda cada envelope para todas as saídas, e um caminho não mexe no outro', async () => {
  const copia: WorkflowParaExecutar = {
    projeto: 'Teste', workflow: 'Copy', parametros: [],
    nos: [
      {id: 'inicio', tipo: 'inicio', rotulo: 'Start', config: {recebeEntrada: true}},
      {id: 'c', tipo: 'copy', rotulo: 'Copy', config: {qtdSaidas: 3}},
      {id: 'ts', tipo: 'typescript', rotulo: 'Mexe', override: true, config: {codigo: 'async function process($input) {}'}},
      {id: 'fim', tipo: 'fim', rotulo: 'End', config: {}},
    ],
    ligacoes: [
      {origem: 'inicio', portaDeOrigem: 'out-0', destino: 'c', portaDeDestino: 'in-0'},
      {origem: 'c', portaDeOrigem: 'out-0', destino: 'ts', portaDeDestino: 'in-0'},
      {origem: 'ts', portaDeOrigem: 'out-0', destino: 'fim', portaDeDestino: 'in-0'},
      {origem: 'c', portaDeOrigem: 'out-1', destino: 'fim', portaDeDestino: 'in-0'},
      {origem: 'c', portaDeOrigem: 'out-2', destino: 'fim', portaDeDestino: 'in-0'},
    ],
  }
  // o script altera o próprio $input (o que um caminho não pode ver no outro)
  const prepararScript = async () => async (input: unknown) => {
    (input as {pessoa: {nome: string}}).pessoa.nome = 'ALTERADO'
    return input
  }
  const r = await executarWorkflow(copia, {
    modo: 'execution', id: 'copy', avaliar, prepararScript, entrada: [{pessoa: {nome: 'ana'}}, {pessoa: {nome: 'bia'}}],
  })
  expect(r.status).toBe('concluida')
  const c = r.componentes.find(x => x.noId === 'c')!
  expect(c.saidas).toEqual({'out-0': 2, 'out-1': 2, 'out-2': 2})
  expect(r.componentes.find(x => x.noId === 'fim')!.entradas['in-0']).toBe(6)
  expect(c.amostraDeSaida['out-1']).toEqual([{pessoa: {nome: 'ana'}}, {pessoa: {nome: 'bia'}}])
  const nomesNoFim = r.componentes.find(x => x.noId === 'fim')!.amostraDeEntrada.map(d => (d as {pessoa: {nome: string}}).pessoa.nome)
  expect(nomesNoFim.filter(n => n === 'ALTERADO')).toHaveLength(2)
})

test('SQL Server Query só aceita consulta somente leitura', () => {
  const ok = ['SELECT * FROM Atendimento WHERE id > @ultimo', 'with x as (select 1 as a) select a from x;', "SELECT 'INSERT INTO x' AS texto -- DELETE\nFROM [Update]"]
  for (const sql of ok) expect(problemaDeSomenteLeitura(sql)).toBeNull()
  const ruins: [string, string][] = [
    ['DELETE FROM Atendimento', 'SELECT ou WITH'],
    ['SELECT * INTO copia FROM Atendimento', 'INTO'],
    ['SELECT 1; DROP TABLE Atendimento', 'mais de um comando'],
    ['WITH x AS (SELECT 1 a) UPDATE t SET a = 1', 'UPDATE'],
    ['SELECT * FROM t WHERE 1 = 1 EXEC xp_cmdshell', 'EXEC'],
    ['SELECT sp_who', 'sp_who'],
    // comentários e textos: o que abre primeiro manda, e bloco pode ser aninhado (como no SQL Server)
    ['-- cabeçalho\nUPDATE t SET a = 1', 'SELECT ou WITH'],
    ["SELECT '--', 1; DELETE FROM t", 'mais de um comando'],
    ["SELECT '/*' AS a; DELETE FROM t --*/", 'mais de um comando'],
    ['/* /* aninhado */ SELECT 1 */ DELETE FROM t', 'SELECT ou WITH'],
  ]
  for (const sql of ['/* /* aninhado */ DELETE */ SELECT 1', "SELECT 'it''s; DELETE' AS a FROM [t]]; DELETE]", '-- autor\n/* nota */\nSELECT 1']) {
    expect(problemaDeSomenteLeitura(sql)).toBeNull()
  }
  for (const [sql, trecho] of ruins) expect(problemaDeSomenteLeitura(sql)).toContain(trecho)
  expect(parametrosUsados('SELECT @@ROWCOUNT, @a, @b, @a, \'@c\'')).toEqual(['a', 'b'])
  expect(COMPONENTES.sqlserver.validar({conexao: 'X', sql: 'SELECT * FROM t WHERE id = @id', parametros: []}))
    .toEqual(['usa @id, que não está nos parâmetros.'])
})

test('SQL Server Query solta um envelope por linha e manda os parâmetros avaliados', async () => {
  const consultas: unknown[] = []
  const consultarSql = async function* (c: {conexao: string; sql: string; parametros: Record<string, unknown>}) {
    consultas.push({conexao: c.conexao, parametros: c.parametros})
    yield {id: 1, nome: 'ana'}
    yield {id: 2, nome: 'bia'}
  }
  const wfSql: WorkflowParaExecutar = {
    projeto: 'Teste', workflow: 'SQL', parametros: [{nome: 'desde', tipo: 'numero', padrao: '10'}],
    nos: [
      {id: 'inicio', tipo: 'inicio', rotulo: 'Start', config: {}},
      {id: 's', tipo: 'sqlserver', rotulo: 'Clientes', override: true, config: {
        conexao: 'MEU_BANCO', sql: 'SELECT id, nome FROM Cliente WHERE id > @desde',
        parametros: [{nome: 'desde', valor: '$PARAMETERS.desde', expression: true}],
      }},
      {id: 'fim', tipo: 'fim', rotulo: 'End', config: {}},
    ],
    ligacoes: [
      {origem: 'inicio', portaDeOrigem: 'out-0', destino: 's', portaDeDestino: 'in-0'},
      {origem: 's', portaDeOrigem: 'out-0', destino: 'fim', portaDeDestino: 'in-0'},
    ],
  }
  const r = await executarWorkflow(wfSql, {modo: 'execution', id: 'sql', avaliar, consultarSql, segredos: {MEU_BANCO: 'Server=x'}})
  expect(r.status).toBe('concluida')
  expect(consultas).toEqual([{conexao: 'Server=x', parametros: {desde: 10}}])
  expect(r.componentes.find(c => c.noId === 's')!.amostraDeSaida['out-0']).toEqual([{id: 1, nome: 'ana'}, {id: 2, nome: 'bia'}])

  // segredo que não existe: falha o envelope (política padrão = parar)
  const semSegredo = await executarWorkflow(wfSql, {modo: 'execution', id: 'sql2', avaliar, consultarSql, segredos: {}})
  expect(semSegredo.status).toBe('falhou')
  expect(semSegredo.erro).toContain('MEU_BANCO')
})

describe('Workflow Invoker', () => {
  const liga = (origem: string, destino: string, portaDeOrigem = 'out-0') => ({origem, portaDeOrigem, destino, portaDeDestino: 'in-0'})
  // B: recebe o envelope e multiplica pelo parâmetro
  const multiplica: WorkflowParaExecutar = {
    id: 'B', projeto: 'Teste', workflow: 'Multiplica', parametros: [{nome: 'vezes', tipo: 'numero', padrao: '1'}],
    nos: [
      {id: 'inicio', tipo: 'inicio', rotulo: 'Start', config: {recebeEntrada: true}},
      {id: 'm', tipo: 'mapper', rotulo: 'Mapper', config: {campos: [{destino: 'total', valor: '$n * $PARAMETERS.vezes', expression: true}]}},
      {id: 'fim', tipo: 'fim', rotulo: 'End', config: {}},
    ],
    ligacoes: [liga('inicio', 'm'), liga('m', 'fim')],
  }
  // C: sempre falha
  const quebra: WorkflowParaExecutar = {
    id: 'C', projeto: 'Teste', workflow: 'Quebra', parametros: [],
    nos: [
      {id: 'inicio', tipo: 'inicio', rotulo: 'Start', config: {}},
      {id: 'm', tipo: 'mapper', rotulo: 'Mapper', config: {campos: [{destino: 'x', valor: '$naoExiste.y', expression: true}]}},
      {id: 'fim', tipo: 'fim', rotulo: 'End', config: {}},
    ],
    ligacoes: [liga('inicio', 'm'), liga('m', 'fim')],
  }
  const pai = (workflowId: string, seErro = 'parar'): WorkflowParaExecutar => ({
    id: 'A', projeto: 'Teste', workflow: 'Pai', parametros: [],
    nos: [
      {id: 'inicio', tipo: 'inicio', rotulo: 'Start', config: {}},
      {id: 'g', tipo: 'datagrid', rotulo: 'Números', config: {colunas: [{nome: 'n', tipo: 'numero'}], linhas: [['1'], ['2']]}},
      {id: 'w', tipo: 'workflow', rotulo: 'Chama', config: {
        workflowId, enviarEnvelope: true, seErro,
        parametros: [{nome: 'vezes', valor: '$n + 1', expression: true}],
      }},
      {id: 'fim', tipo: 'fim', rotulo: 'End', config: {}},
    ],
    ligacoes: [liga('inicio', 'g'), liga('g', 'w'), liga('w', 'fim'), liga('w', 'fim', 'erro')],
  })
  const workflows = {B: multiplica, C: quebra}

  test('chama o outro workflow por envelope, com os parâmetros e a entrada, e devolve o que chega ao End dele', async () => {
    const r = await executarWorkflow(pai('B'), {modo: 'execution', id: 'pai', avaliar, workflows})
    expect(r.status).toBe('concluida')
    const w = r.componentes.find(c => c.noId === 'w')!
    // n = 1 → vezes 2 → total 2; n = 2 → vezes 3 → total 6
    expect(w.amostraDeSaida['out-0']).toEqual([{n: 1, total: 2}, {n: 2, total: 6}])
    expect(w.subexecucoes?.map(s => [s.workflow, s.status])).toEqual([['Multiplica', 'concluida'], ['Multiplica', 'concluida']])
  })

  test('workflow que falha é erro do envelope (Desviar manda para a porta de erro)', async () => {
    const parou = await executarWorkflow(pai('C'), {modo: 'execution', id: 'p1', avaliar, workflows})
    expect(parou.status).toBe('falhou')
    expect(parou.erro).toContain('O workflow "Quebra" falhou')
    const desviou = await executarWorkflow(pai('C', 'desviar'), {modo: 'execution', id: 'p2', avaliar, workflows})
    expect(desviou.status).toBe('concluida')
    expect(desviou.componentes.find(c => c.noId === 'w')!.saidas['erro']).toBe(2)
  })

  test('chamada circular é barrada', async () => {
    const circular = await executarWorkflow(pai('A'), {modo: 'execution', id: 'p3', avaliar, workflows: {...workflows, A: pai('A')}})
    expect(circular.status).toBe('falhou')
    expect(circular.erro).toContain('Chamada circular de workflows: Pai → Pai')
  })
})
