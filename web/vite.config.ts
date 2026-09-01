import path from 'node:path'
import type { Connect, Plugin } from 'vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Control plane is proxied so the SPA stays same-origin (no CORS, cookies work).
// `/w7s/vtransport` is intentionally absent: WebTransport runs on HTTP/3 and cannot be
// proxied — point VITE_SPECULUM_TRANSPORT_ORIGIN at the API's HTTPS origin instead.
// `/w7s/vstream` (WebSocket data plane) is proxied like `/w7s/vhub`.
const apiTarget = process.env.VITE_SPECULUM_API_PROXY ?? 'https://localhost:5001'

/**
 * Vite `base: '/w7s/'` serves the app under `/w7s`, but Live catch-all routes live at
 * `/`, `/search`, etc. Rewrite non-control browser navigations to the SPA entry.
 */
function liveSpaFallback(): Plugin {
  return {
    name: 'speculum-live-spa-fallback',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? '/'
        const pathname = url.split('?')[0] ?? '/'
        if (
          pathname.startsWith('/w7s')
          || pathname.startsWith('/@')
          || pathname.startsWith('/node_modules')
          || pathname.startsWith('/src')
          || pathname.includes('.')
        ) {
          next()
          return
        }
        const rest = url.slice(pathname.length)
        ;(req as Connect.IncomingMessage).url = `/w7s/${rest}`
        next()
      })
    },
  }
}

export default defineConfig({
  base: '/w7s/',
  plugins: [react(), tailwindcss(), liveSpaFallback()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/w7s/vhub': { target: apiTarget, ws: true, secure: false, changeOrigin: true },
      '/w7s/vstream': { target: apiTarget, ws: true, secure: false, changeOrigin: true },
      '/w7s/health': { target: apiTarget, secure: false, changeOrigin: true },
      '/w7s/api': { target: apiTarget, secure: false, changeOrigin: true },
      '/w7s/virtual-assets': { target: apiTarget, secure: false, changeOrigin: true },
      '/w7s/virtual-blob': { target: apiTarget, secure: false, changeOrigin: true },
      '/w7s/virtual-data': { target: apiTarget, secure: false, changeOrigin: true },
    },
  },
})
