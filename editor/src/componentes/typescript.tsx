import {FileCode2} from 'lucide-react'
import {configDoTypescript, typescript} from '@dataflow/core'
import {EditorDeCodigo} from '@/ui/editor-de-codigo'
import type {CamposProps, ComponenteDef} from './tipos'

// Parte visual do TypeScript. A lógica é a do core; quem compila e roda o código é o runner.

/** Tipo de retorno declarado na função process (ex.: `Promise<Data[]>`), lido do código; sem tipo, undefined. */
function retornoDoProcess(codigo: string): string | undefined {
  const inicio = codigo.search(/\bfunction\s+process\s*\(/)
  if (inicio < 0) return undefined
  let i = codigo.indexOf('(', inicio)
  // fecha os parênteses dos parâmetros (que podem ter tipos com parênteses dentro)
  for (let nivel = 0; i < codigo.length; i++) {
    if (codigo[i] === '(') nivel++
    else if (codigo[i] === ')' && --nivel === 0) break
  }
  const resto = codigo.slice(i + 1)
  const doisPontos = resto.match(/^\s*:/)
  if (!doisPontos) return undefined
  // o tipo vai até a { do corpo: a primeira { fora de <>, () e []
  let nivel = 0
  for (let j = doisPontos[0].length; j < resto.length; j++) {
    const c = resto[j]
    if ('<(['.includes(c)) nivel++
    else if ('>)]'.includes(c)) nivel--
    else if (c === '{' && nivel === 0) return resto.slice(doisPontos[0].length, j).trim() || undefined
  }
  return undefined
}

function CardTypescript({config}: CamposProps) {
  const retorno = retornoDoProcess(configDoTypescript(config).codigo)
  return retorno
    ? <p className="truncate font-mono text-xs text-primary" title={retorno}>{retorno}</p>
    : <p className="text-xs italic text-muted-foreground">Sem tipo de retorno</p>
}

function PainelTypescript({noId, config, setConfig}: CamposProps) {
  const {codigo} = configDoTypescript(config)
  return (
    <div className="flex min-h-[420px] flex-1 !shrink flex-col gap-3">
      <div className="relative min-h-[300px] flex-1">
        <EditorDeCodigo valor={codigo} onValor={v => setConfig('codigo', v)} caminho={noId} rotulo="Código TypeScript"/>
      </div>
    </div>
  )
}

function DocumentacaoTypescript() {
  return (
    <>
      <p>Código TypeScript que processa os envelopes. O código precisa ter a função <code>process</code>; outras funções e tipos podem ficar no mesmo código e ser chamados por ela.</p>
      <pre>{`async function process($input: Data): Promise<Data | Data[] | null> {
  return {...$input, total: soma($input.itens)}
}

function soma(itens: {valor: number}[]) {
  return itens.reduce((s, i) => s + i.valor, 0)
}`}</pre>
      <h4>Entrada</h4>
      <p>1 porta de envelopes. O process é chamado uma vez por envelope e <code>$input</code> é o <code>DATA</code> dele. Para processar vários de uma vez (ex.: uma chamada de API a cada 500), ponha um Aggregate antes: aí <code>$input.items</code> é a lista.</p>
      <h4>Retorno</h4>
      <p><b>Override desligado</b> (padrão): o retorno, seja qual for (objeto, lista, texto, número), vai para a chave no envelope (<code>$resultado</code>, dá para trocar o nome) e o envelope segue com o resto do <code>DATA</code>.</p>
      <p><b>Override ligado</b>: o retorno vira o <code>DATA</code> inteiro. Um objeto = 1 envelope; uma lista de objetos = 1 envelope por item; <code>null</code> = nenhum envelope.</p>
      <h4>Globais</h4>
      <p><code>$PARAMETERS</code>, <code>$SECRETS</code>, <code>$WORKFLOW_CURRENT_RUN</code> e <code>log(...)</code>, que escreve na aba Logs. Também valem <code>fetch</code>, <code>URL</code>, <code>setTimeout</code> e parecidos. Não há <code>require</code>, <code>import</code>, disco nem <code>process.env</code>.</p>
      <h4>Tempo</h4>
      <p>Cada chamada do process tem até 30 s (5 s de processamento contínuo); passou disso, é erro.</p>
      <h4>Erros</h4>
      <p>Exceção no process é erro do envelope e segue a política "Em caso de erro" do card. Código que não compila ou sem a função <code>process</code> faz o componente falhar.</p>
    </>
  )
}

export const TYPESCRIPT: ComponenteDef = {
  tipo: typescript.tipo,
  rotulo: 'TypeScript',
  descricao: 'Processa os envelopes com código',
  categoria: 'codigo',
  icone: FileCode2,
  entradas: typescript.entradas,
  saidas: typescript.saidas,
  usaOverride: true,
  chaveDeSaidaPadrao: typescript.chaveDeSaidaPadrao,
  configPadrao: {codigo: configDoTypescript({}).codigo},
  tamanhoDaJanela: {w: 760, h: 620},
  Card: CardTypescript,
  Painel: PainelTypescript,
  Documentacao: DocumentacaoTypescript,
  validar: config => typescript.validar(config),
}
