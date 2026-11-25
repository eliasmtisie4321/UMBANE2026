/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Root-relative on purpose: an absolute path built from import.meta.url can differ from the
  // project root in drive-letter case on Windows (C:\ vs c:\), loading modules twice and
  // splitting React context. TypeScript resolves '@/*' separately via tsconfig paths.
  resolve: { alias: { '@': '/src' } },
  test: {
    environment: 'jsdom',
    testTimeout: 15_000,
    setupFiles: ['./src/test-setup.ts'],
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
