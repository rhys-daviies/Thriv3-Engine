import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
      // Modules imported by both the React app and the Express server —
      // sport field definitions now, the event payload contract from Stage 5.
      '@shared': path.resolve(process.cwd(), 'shared'),
    },
  },
  server: {
    port: 5183,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
