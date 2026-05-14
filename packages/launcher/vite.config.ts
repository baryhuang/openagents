import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist-renderer'),
    emptyOutDir: true,
    sourcemap: true,
    target: 'chrome120',
    rollupOptions: {
      input: path.resolve(__dirname, 'src/renderer/index.html'),
    },
  },
  server: {
    port: 5180,
    strictPort: true,
  },
});
