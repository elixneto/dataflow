import {useEffect, useState} from 'react'
import Editor, {loader} from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

// Monaco empacotado junto (sem CDN), com os workers do Vite
self.MonacoEnvironment = {
  getWorker: (_, label) => (label === 'typescript' || label === 'javascript' ? new tsWorker() : new editorWorker()),
}
loader.config({monaco})

const ts = monaco.languages.typescript
ts.typescriptDefaults.setCompilerOptions({
  target: ts.ScriptTarget.ESNext,
  lib: ['esnext', 'dom'],
  strict: false,
  noEmit: true,
  allowNonTsExtensions: true,
  // cada componente é um módulo: dois componentes TypeScript abertos não brigam pela função process
  moduleDetection: 3,
} as monaco.languages.typescript.CompilerOptions)

/** Globais que o runner põe à disposição do código (ver runner/src/scripts.ts). */
ts.typescriptDefaults.addExtraLib(`
type Data = Record<string, any>
/** Parâmetros do workflow. */
declare const $PARAMETERS: Record<string, any>
/** Segredos do projeto (ex.: senha do banco, token da API). */
declare const $SECRETS: Record<string, string>
declare const $WORKFLOW_CURRENT_RUN: {id: string; mode: 'validation' | 'execution'; project: string; workflow: string; startedAt: string}
/** Escreve no log do componente (aba Logs do resultado). */
declare function log(...partes: unknown[]): void
`, 'file:///dataflow-globais.d.ts')

function temaAtual() {
  return document.documentElement.classList.contains('dark') ? 'vs-dark' : 'light'
}

/**
 * Editor de código (Monaco): TypeScript com as globais do runner, ou SQL; acompanha o tema claro/escuro.
 * Ocupa o pai inteiro (que precisa ser `relative` e ter altura).
 */
export function EditorDeCodigo({valor, onValor, caminho, rotulo, linguagem = 'typescript'}: {
  valor: string
  onValor: (valor: string) => void
  /** um por componente (ex.: o id do nó), para o Monaco não misturar os modelos */
  caminho: string
  rotulo: string
  linguagem?: 'typescript' | 'sql'
}) {
  const [tema, setTema] = useState(temaAtual)
  useEffect(() => {
    const observador = new MutationObserver(() => setTema(temaAtual()))
    observador.observe(document.documentElement, {attributes: true, attributeFilter: ['class']})
    return () => observador.disconnect()
  }, [])

  return (
    <div className="nodrag nowheel absolute inset-0 overflow-hidden rounded-md border border-input" aria-label={rotulo}>
      <Editor
        language={linguagem}
        path={`file:///componentes/${caminho}.${linguagem === 'sql' ? 'sql' : 'ts'}`}
        value={valor}
        onChange={v => onValor(v ?? '')}
        theme={tema}
        options={{
          minimap: {enabled: false},
          fontSize: 13,
          tabSize: 2,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          fixedOverflowWidgets: true,
          lineNumbersMinChars: 3,
        }}
      />
    </div>
  )
}
