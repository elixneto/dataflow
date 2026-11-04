import { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { LoaderCircle } from 'lucide-react';
import { SCRIPT_GLOBALS, scriptModuleUri } from '@dataflow/core';
import { saveScript, useScriptContent } from '@/data/scripts/scripts-store';
import { ts, useScriptModels } from '@/editor/monaco-setup';

const isDark = () => document.documentElement.classList.contains('dark');

/**
 * A script's code in Monaco, on its own model (the one every editor of the project shares), so the other scripts and
 * the TypeScript components see it as it is typed. Its code loads when it is opened (and what it imports, then).
 */
export default function ScriptEditor({ projectId, path }: { projectId: string; path: string }) {
  const [dark, setDark] = useState(isDark);
  const content = useScriptContent(projectId, path);
  useScriptModels(projectId);
  // a script runs in a TypeScript component: it sees the runner's globals too (log, $PARAMETERS...)
  useEffect(() => ts.typescriptDefaults.setExtraLibs([{ content: SCRIPT_GLOBALS, filePath: 'file:///dataflow-globals.d.ts' }]), []);
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(isDark()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  if (!content) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
      </div>
    );
  }

  return (
    <Editor
      language="typescript"
      path={scriptModuleUri(path)}
      value={content.code}
      theme={dark ? 'vs-dark' : 'light'}
      onChange={next => saveScript(projectId, path, next ?? '')}
      options={{ minimap: { enabled: false }, fontSize: 13, tabSize: 2, scrollBeyondLastLine: false, automaticLayout: true, fixedOverflowWidgets: true, editContext: false }}
    />
  );
}
