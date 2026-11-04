import { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { SCRIPT_GLOBALS, scriptModuleUri } from '@dataflow/core';
import { saveScript, type Script } from '@/data/scripts/scripts-mock';
import { ts, useScriptModels } from '@/editor/monaco-setup';

const isDark = () => document.documentElement.classList.contains('dark');

/**
 * A script's code in Monaco, on its own model (the one every editor of the project shares), so the other scripts and
 * the TypeScript components see it as it is typed. Loaded only when the Scripts tab shows a script.
 */
export default function ScriptEditor({ projectId, script }: { projectId: string; script: Script }) {
  const [dark, setDark] = useState(isDark);
  useScriptModels(projectId);
  // a script runs in a TypeScript component: it sees the runner's globals too (log, $PARAMETERS...)
  useEffect(() => ts.typescriptDefaults.setExtraLibs([{ content: SCRIPT_GLOBALS, filePath: 'file:///dataflow-globals.d.ts' }]), []);
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(isDark()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return (
    <Editor
      language="typescript"
      path={scriptModuleUri(script.path)}
      value={script.code}
      theme={dark ? 'vs-dark' : 'light'}
      onChange={next => saveScript(projectId, script.path, next ?? '')}
      options={{ minimap: { enabled: false }, fontSize: 13, tabSize: 2, scrollBeyondLastLine: false, automaticLayout: true, fixedOverflowWidgets: true, editContext: false }}
    />
  );
}
