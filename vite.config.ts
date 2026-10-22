import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // maplibre resolves its worker file relative to its own module; pre-bundling breaks that path
  optimizeDeps: { exclude: ['maplibre-gl'] },
})
