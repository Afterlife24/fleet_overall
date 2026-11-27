import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  server: {
    proxy: {
      // Relative /api/v1 calls reach the local Express server during development.
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
});
