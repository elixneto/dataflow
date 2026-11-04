import { useEffect } from 'react';
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import { boundNames, SCRIPT_IMPORT_PREFIX, SCRIPT_MODULE_DIR, scriptExports, scriptImport, scriptImportLine, scriptModuleUri } from '@dataflow/core';
import { useProjectScripts, type Script } from '@/data/scripts/scripts-mock';

/*
 * Monaco, set up once (bundled in, no CDN, with Vite's workers) for every code editor: a component's settings and the
 * project's Scripts tab. The project's scripts are models at file:///myproject/scripts/<path>.ts and
 * `@myproject/scripts/<path>` points there, so a TypeScript component (or a script) imports them with autocomplete,
 * errors and go to definition.
 */

self.MonacoEnvironment = {
  getWorker: (_, label) => (label === 'typescript' || label === 'javascript' ? new tsWorker() : new editorWorker()),
};
loader.config({ monaco });

export const ts = monaco.typescript;
ts.typescriptDefaults.setCompilerOptions({
  target: ts.ScriptTarget.ESNext,
  lib: ['esnext', 'dom'],
  strict: false,
  noEmit: true,
  allowNonTsExtensions: true,
  // each component is a module: two open TypeScript components do not fight over the process function
  moduleDetection: 3,
  // the project's scripts by their path
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
  baseUrl: 'file:///',
  paths: { [`${SCRIPT_IMPORT_PREFIX}*`]: [`${SCRIPT_MODULE_DIR}/*`] },
} as monaco.typescript.CompilerOptions);
// the TypeScript worker sees every model, not only the ones open in an editor: the scripts a code imports are not open
ts.typescriptDefaults.setEagerModelSync(true);
// JavaScript (a MongoDB pipeline or filter) is an expression with the envelope's $variables: not checked
ts.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true });

/** the project's scripts as the code editors have them now (what auto-import offers) */
let currentScripts: Script[] = [];

/** the script a model is, or null (a component's code) */
const scriptPathOf = (model: monaco.editor.ITextModel) => {
  const prefix = `file:///${SCRIPT_MODULE_DIR}/`;
  const uri = model.uri.toString();
  return uri.startsWith(prefix) ? uri.slice(prefix.length).replace(/\.ts$/, '') : null;
};

/** what a model may import: every name another script exports */
const importable = (model: monaco.editor.ITextModel) => {
  const own = scriptPathOf(model);
  return currentScripts.filter(s => s.path !== own).flatMap(s => scriptExports(s.code).map(e => ({ ...e, path: s.path })));
};

/** the edit that adds the import of `name` (after the imports at the top), or none when it is imported already */
function importEdit(model: monaco.editor.ITextModel, path: string, name: string, typeOnly: boolean): monaco.languages.TextEdit[] {
  // the code has that name already (imported from this script or another, or its own): a second one would clash
  if (boundNames(model.getValue()).has(name)) {
    return [];
  }

  const lines = model.getLinesContent();
  let after = 0;
  lines.forEach((line, i) => {
    if (/^\s*import\b/.test(line)) {
      after = i + 1;
    }
  });
  return [{ range: new monaco.Range(after + 1, 1, after + 1, 1), text: `${scriptImportLine(path, name, typeOnly)}\n` }];
}

// auto-import: typing a name a project script exports offers it, and choosing it adds its import at the top
monaco.languages.registerCompletionItemProvider('typescript', {
  provideCompletionItems(model, position) {
    const word = model.getWordUntilPosition(position);
    // not in an import line itself, and only once something is typed
    if (!word.word || /^\s*import\b/.test(model.getLineContent(position.lineNumber))) {
      return { suggestions: [] };
    }

    const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
    const typed = word.word.toLowerCase();
    const bound = boundNames(model.getValue());
    return {
      // one per script that exports the name (its path beside it); none for a name the code has already (TypeScript
      // offers that one itself)
      suggestions: importable(model)
        .filter(e => e.name.toLowerCase().startsWith(typed) && !bound.has(e.name))
        .map(e => ({
          label: { label: e.name, description: scriptImport(e.path) },
          kind: e.typeOnly ? monaco.languages.CompletionItemKind.Interface : monaco.languages.CompletionItemKind.Function,
          detail: `Import from '${scriptImport(e.path)}'`,
          insertText: e.name,
          range,
          additionalTextEdits: importEdit(model, e.path, e.name, e.typeOnly),
        })),
    };
  },
});

/** "Cannot find name 'X'" (and "Did you mean...?"): the errors an import fixes */
const MISSING_NAME = new Set([2304, 2552]);

// TypeScript's own quick fixes go through the provider below: its "Add import" would take a relative path
// ('./types', '../myproject/scripts/...'), which the runner does not resolve
ts.typescriptDefaults.setModeConfiguration({ ...ts.typescriptDefaults.modeConfiguration, codeActions: false });

type TsTextChange = { span: { start: number; length: number }; newText: string };
type TsCodeFix = { description: string; changes: { fileName: string; textChanges: TsTextChange[] }[] };

/** TypeScript's quick fixes at a range, as Monaco actions, without the imports by a relative path */
async function typescriptFixes(model: monaco.editor.ITextModel, range: monaco.Range, markers: monaco.editor.IMarkerData[]) {
  const codes = markers.map(m => Number(typeof m.code === 'object' ? m.code.value : m.code)).filter(Number.isFinite);
  if (codes.length === 0) {
    return [];
  }

  const worker = await (await ts.getTypeScriptWorker())(model.uri);
  const start = model.getOffsetAt(range.getStartPosition());
  const end = model.getOffsetAt(range.getEndPosition());
  const fixes = (await worker.getCodeFixesAtPosition(model.uri.toString(), start, end, codes, { insertSpaces: true, tabSize: 2 })) as TsCodeFix[];
  if (model.isDisposed()) {
    return [];
  }

  return fixes
    .filter(fix => !fix.changes.some(change => change.textChanges.some(t => /from ['"]\.{1,2}\//.test(t.newText))))
    .map(
      (fix): monaco.languages.CodeAction => ({
        title: fix.description,
        kind: 'quickfix',
        diagnostics: markers,
        edit: {
          edits: fix.changes
            .filter(change => change.fileName === model.uri.toString())
            .flatMap(change =>
              change.textChanges.map(t => {
                const from = model.getPositionAt(t.span.start);
                const to = model.getPositionAt(t.span.start + t.span.length);
                return {
                  resource: model.uri,
                  textEdit: { range: new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column), text: t.newText },
                  versionId: model.getVersionId(),
                };
              }),
            ),
        },
      }),
    );
}

// the quick fixes: "Add import from '@myproject/scripts/...'" on a name a script exports, then TypeScript's own
monaco.languages.registerCodeActionProvider('typescript', {
  async provideCodeActions(model, range, context) {
    const actions: monaco.languages.CodeAction[] = [];
    for (const marker of context.markers) {
      const code = Number(typeof marker.code === 'object' ? marker.code.value : marker.code);
      if (!MISSING_NAME.has(code)) {
        continue;
      }

      const name = model.getValueInRange(marker);
      for (const found of importable(model).filter(e => e.name === name)) {
        const edits = importEdit(model, found.path, found.name, found.typeOnly);
        if (edits.length) {
          actions.push({
            title: `Add import from '${scriptImport(found.path)}'`,
            kind: 'quickfix',
            diagnostics: [marker],
            isPreferred: true,
            edit: { edits: edits.map(textEdit => ({ resource: model.uri, textEdit, versionId: model.getVersionId() })) },
          });
        }
      }
    }

    const own = await typescriptFixes(model, monaco.Range.lift(range), context.markers).catch(() => []);
    return { actions: [...actions, ...own], dispose: () => {} };
  },
});

/** the scripts' models as the scripts are now: new ones created, changed ones updated, removed ones gone */
export function syncScriptModels(scripts: Script[]) {
  currentScripts = scripts;
  const wanted = new Map(scripts.map(s => [scriptModuleUri(s.path), s.code]));
  for (const model of monaco.editor.getModels()) {
    const uri = model.uri.toString();
    if (uri.startsWith(`file:///${SCRIPT_MODULE_DIR}/`) && !wanted.has(uri)) {
      model.dispose();
    }
  }

  for (const [uri, code] of wanted) {
    const model = monaco.editor.getModel(monaco.Uri.parse(uri));
    if (!model) {
      monaco.editor.createModel(code, 'typescript', monaco.Uri.parse(uri));
    } else if (model.getValue() !== code) {
      model.setValue(code);
    }
  }
}

/** keeps the project's scripts as Monaco models while the editor that uses them is open */
export function useScriptModels(projectId: string) {
  const { scripts } = useProjectScripts(projectId);
  useEffect(() => syncScriptModels(scripts), [scripts]);
}
