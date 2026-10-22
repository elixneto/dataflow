import {useEffect, useState} from 'react'
import Editor, {loader} from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

// Monaco bundled in (no CDN), with Vite's workers
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
  // each component is a module: two open TypeScript components do not fight over the process function
  moduleDetection: 3,
} as monaco.languages.typescript.CompilerOptions)

/** Globals the runner makes available to the code (see runner/src/scripts.ts). */
ts.typescriptDefaults.addExtraLib(`
type Data = Record<string, any>
/** Workflow parameters. */
declare const $PARAMETERS: Record<string, any>
/** Project secrets (e.g. database password, API token). */
declare const $SECRETS: Record<string, string>
declare const $WORKFLOW_CURRENT_RUN: {id: string; mode: 'validation' | 'execution'; project: string; workflow: string; startedAt: string}
/** Writes to the component's log (Logs tab of the result). */
declare function log(...parts: unknown[]): void
`, 'file:///dataflow-globals.d.ts')

function currentTheme() {
  return document.documentElement.classList.contains('dark') ? 'vs-dark' : 'light'
}

/**
 * Code editor (Monaco): TypeScript with the runner's globals, or SQL; follows the light/dark theme.
 * Fills the whole parent (which must be `relative` and have a height).
 */
export function CodeEditor({value, onValue, path, label, language = 'typescript'}: {
  value: string
  onValue: (value: string) => void
  /** one per component (e.g. the node id), so Monaco does not mix the models */
  path: string
  label: string
  language?: 'typescript' | 'sql'
}) {
  const [theme, setTheme] = useState(currentTheme)
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentTheme()))
    observer.observe(document.documentElement, {attributes: true, attributeFilter: ['class']})
    return () => observer.disconnect()
  }, [])

  return (
    <div className="nodrag nowheel absolute inset-0 overflow-hidden rounded-md border border-input" aria-label={label}>
      <Editor
        language={language}
        path={`file:///components/${path}.${language === 'sql' ? 'sql' : 'ts'}`}
        value={value}
        onChange={v => onValue(v ?? '')}
        theme={theme}
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
