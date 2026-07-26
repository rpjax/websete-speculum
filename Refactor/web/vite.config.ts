import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Control plane is proxied so the SPA stays same-origin (no CORS, cookies work).
// `/vtransport` is intentionally absent: WebTransport runs on HTTP/3 and cannot be
// proxied — point VITE_SPECULUM_TRANSPORT_ORIGIN at the API's HTTPS origin instead.
const apiTarget = process.env.VITE_SPECULUM_API_PROXY ?? 'https://localhost:5001'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/vhub': { target: apiTarget, ws: true, secure: false, changeOrigin: true },
      '/health': { target: apiTarget, secure: false, changeOrigin: true },
      '/api': { target: apiTarget, secure: false, changeOrigin: true },
    },
  },
})
