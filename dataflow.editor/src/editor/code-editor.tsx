import { useContext, useEffect, useState } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import { ScriptGlobalsContext } from './project-resources';

/*
 * The code editor (Monaco, as in the PoC), bundled in (no CDN) with Vite's workers. Loaded only when a window shows a
 * code setting (settings-form lazy-loads this file), so the canvas does not carry it.
 */

self.MonacoEnvironment = {
  getWorker: (_, label) => (label === 'typescript' || label === 'javascript' ? new tsWorker() : new editorWorker()),
};
loader.config({ monaco });

const ts = monaco.typescript;
ts.typescriptDefaults.setCompilerOptions({
  target: ts.ScriptTarget.ESNext,
  lib: ['esnext', 'dom'],
  strict: false,
  noEmit: true,
  allowNonTsExtensions: true,
  // each component is a module: two open TypeScript components do not fight over the process function
  moduleDetection: 3,
} as monaco.typescript.CompilerOptions);
// JavaScript (a MongoDB pipeline or filter) is an expression with the envelope's $variables: not checked
ts.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true });

const isDark = () => document.documentElement.classList.contains('dark');

const EXTENSION = { typescript: 'ts', javascript: 'js', sql: 'sql', json: 'json' } as const;

export type CodeLanguage = keyof typeof EXTENSION;

/**
 * Code: TypeScript with the runner's globals (autocomplete, errors), JavaScript, SQL or JSON highlighted; follows the
 * light/dark theme.
 */
export default function CodeEditor({ id, value, language, label, onChange }: { id: string; value: string; language: CodeLanguage; label: string; onChange: (value: string) => void }) {
  const [dark, setDark] = useState(isDark);
  // the runner's globals ($PARAMETERS typed from this flow's Start, $SECRETS, $VARIABLES, $FLOW_CURRENT_RUN, log), from the core
  const globals = useContext(ScriptGlobalsContext);
  useEffect(() => {
    ts.typescriptDefaults.setExtraLibs([{ content: globals, filePath: 'file:///dataflow-globals.d.ts' }]);
  }, [globals]);
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(isDark()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return (
    <div id={id} aria-label={label} className="nodrag nowheel h-72 overflow-hidden rounded-lg border border-input">
      <Editor
        language={language}
        // one model per component and setting, so Monaco does not mix them
        path={`file:///components/${id}.${EXTENSION[language]}`}
        value={value}
        theme={dark ? 'vs-dark' : 'light'}
        onChange={next => onChange(next ?? '')}
        options={{
          minimap: { enabled: false },
          fontSize: 12,
          tabSize: 2,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          fixedOverflowWidgets: true,
          lineNumbersMinChars: 3,
        }}
      />
    </div>
  );
}
