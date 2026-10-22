import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // maplibre resolves its worker file relative to its own module; pre-bundling breaks that path
  optimizeDeps: { exclude: ['maplibre-gl'] },
  // api/ has its own package and vitest run
  test: { exclude: [...configDefaults.exclude, 'api/**'] },
})
