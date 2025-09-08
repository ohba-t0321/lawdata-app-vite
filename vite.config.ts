import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: "/lawdata-app-vite",
  build: {
    outDir: "dist", // Viteデフォルト dist/
  },
  plugins: [react()],
})
