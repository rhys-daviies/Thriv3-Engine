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
  /**
   * Ports from the environment, defaults unchanged — 13J.
   *
   * `strictPort` with a hardcoded pair means a second checkout of this
   * repository cannot run its dev server at all while the first one is up,
   * which is exactly the situation a delivery branch is developed in.
   * `CLIENT_PORT` and `API_PORT` move both halves together, and the proxy
   * target follows the API port so the two cannot drift apart.
   */
  server: {
    port: Number(process.env.CLIENT_PORT || 5183),
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.API_PORT || 8787}`,
        changeOrigin: true,
      },
      '/uploads': {
        target: `http://localhost:${process.env.API_PORT || 8787}`,
        changeOrigin: true,
      },
    },
  },
});
