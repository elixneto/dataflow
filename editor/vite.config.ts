import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import {fileURLToPath, URL} from 'node:url'

// The workflows app at the root (projects → flows, runs, secrets, files); in dev it runs with `npm run start`.
// The runner (Bun) runs separately; in dev /api is proxied to it.
export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@dataflow/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
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
})
