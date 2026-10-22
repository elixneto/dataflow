import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import {fileURLToPath, URL} from 'node:url'

// Aplicação dos workflows na raiz (projetos → fluxos, execuções, segredos, arquivos); em dev roda com `npm run start`.
// O runner (runner, Bun) roda à parte; em dev o /api é repassado para ele.
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
