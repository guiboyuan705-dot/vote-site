import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = env.VITE_BASE || process.env.VITE_BASE || '/vote-site/'
  return {
    base: base.endsWith('/') ? base : `${base}/`,
    plugins: [react()],
    server: { host: '0.0.0.0', port: 5173 },
    preview: { host: '0.0.0.0', port: 4173 },
  }
})
