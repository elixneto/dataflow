import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type ProxyOptions } from 'vite'

/*
 * When dataflow.server is down, Vite logs a stack trace for every proxied request, and the editor checks /health every
 * 5 seconds (src/lib/server-connection.ts). This answers those failures itself, before Vite's own handler: /health
 * gets a silent 503, any other call a 502 and one short line in the terminal.
 */
const quietWhenServerIsDown: ProxyOptions['configure'] = proxy => {
  const emit = proxy.emit.bind(proxy) as (event: string | symbol, ...args: unknown[]) => boolean
  proxy.emit = ((event: string | symbol, ...args: unknown[]) => {
    if (event !== 'error') {
      return emit(event, ...args)
    }

    const [, req, res] = args as [Error, IncomingMessage, ServerResponse | undefined]
    if (!res || !('writeHead' in res)) {
      return emit(event, ...args) // a websocket: Vite's handler
    }

    // the path after the rewrite below: /health, /projects...
    if (!req.url?.startsWith('/health')) {
      console.warn(`[api] server unreachable: ${req.method} /api${req.url}`)
    }

    if (!res.headersSent && !res.writableEnded) {
      res.writeHead(req.url?.startsWith('/health') ? 503 : 502, { 'Content-Type': 'text/plain' }).end()
    }

    return true
  }) as typeof proxy.emit
}

// https://vite.dev/config/
// in dev, /api/... goes to dataflow.server (API_PORT, 5190 by default) without the /api prefix: /api/projects -> /projects
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // bun keeps each package in its own folder (node_modules/.bun): without this, libraries such as radix-ui get
    // their own copy of React in Vite's pre-bundle and hooks break ("Invalid hook call", black screen)
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5180,
    proxy: {
      '/api': {
        target: 'http://localhost:5190',
        rewrite: path => path.replace(/^\/api/, ''),
        configure: quietWhenServerIsDown,
      },
    },
  },
})
