/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Root-relative on purpose: an absolute path built from import.meta.url can differ from the
  // project root in drive-letter case on Windows (C:\ vs c:\), loading modules twice and
  // splitting React context. TypeScript resolves '@/*' separately via tsconfig paths.
  resolve: { alias: { '@': '/src', '@shared': '/shared' } },
  build: {
    rollupOptions: {
      output: {
        // Libraries change less often than the app, so they get their own files that browsers can
        // keep cached between releases. Each screen is already its own chunk (React.lazy in App.tsx).
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (/[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id))
            return 'react'
          if (id.includes('@supabase')) return 'supabase'
          if (id.includes('lucide-react')) return 'icons'
          return undefined
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    testTimeout: 15_000,
    setupFiles: ['./src/test-setup.ts'],
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
