import { readFileSync } from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'

// maplibre loads its worker from a sibling of its chunk (/assets/maplibre-gl-worker.mjs). The bundler never sees that
// reference, so without this the production build ships no worker and the map draws nothing.
const maplibreWorker = (): Plugin => ({
  name: 'maplibre-worker',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'assets/maplibre-gl-worker.mjs', source: readFileSync('node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs') })
  },
})

export default defineConfig({
  plugins: [react(), tailwindcss(), maplibreWorker()],
  // maplibre resolves its worker file relative to its own module; pre-bundling breaks that path
  optimizeDeps: { exclude: ['maplibre-gl'] },
  // api/ has its own package and vitest run
  test: { exclude: [...configDefaults.exclude, 'api/**'] },
})
