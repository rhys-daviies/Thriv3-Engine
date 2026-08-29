import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const API_TARGET = `http://localhost:${process.env.API_PORT || 8787}`;

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
    port: Number(process.env.VITE_PORT || 5183),
    strictPort: true,
    proxy: {
      // API_PORT so one variable moves the server and the proxy together —
      // server/index.js already reads it. Without this the only way to run a
      // second instance beside a running dev server was to edit this file.
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
      '/uploads': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
});
