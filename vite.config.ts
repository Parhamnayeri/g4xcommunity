import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname, 'frontend'),
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/OwnerGate': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/ownergate': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/legacy': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'frontend/dist'),
    emptyOutDir: true,
  },
});
