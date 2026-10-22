import {defineConfig, type Plugin} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {fileURLToPath, URL} from 'node:url';

const slashes = (path: string) => path.replace(/\\/g, '/');
const SRC = slashes(fileURLToPath(new URL('./src/', import.meta.url)));

/**
 * The editor's `#folder/...` imports (the `imports` field of package.json) go to src/folder, trying the extensions
 * (.ts or .tsx), which Vite does not do for subpath imports. Core files keep their own `#types` (core/package.json).
 */
function editorImports(): Plugin {
  return {
    name: 'editor-imports',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!source.startsWith('#') || !importer || !slashes(importer).startsWith(SRC)) return null;
      return this.resolve(SRC + source.slice(1), importer, {skipSelf: true});
    },
  };
}

// The workflows app at the root (projects → flows, runs, secrets, files); in dev it runs with `npm run start`.
// The runner (Bun) runs separately; in dev /api is proxied to it.
export default defineConfig({
  base: '/',
  plugins: [editorImports(), react(), tailwindcss()],
  resolve: {
    alias: {
      '@dataflow/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5180,
    fs: {allow: ['..']},
    proxy: {
      '/api': {
        target: process.env.RUNNER_URL ?? 'http://localhost:5190',
      },
    },
  },
});
