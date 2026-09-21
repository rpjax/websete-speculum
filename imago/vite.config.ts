import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'ui',
  plugins: [react()],
  build: { outDir: '../dist/ui', emptyOutDir: true },
  server: { port: 5174, proxy: { '/api': 'http://127.0.0.1:7411', '/ws': { target: 'ws://127.0.0.1:7411', ws: true } } },
})
