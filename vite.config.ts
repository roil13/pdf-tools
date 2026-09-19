import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src',
  base: './',                       // relative paths: required for file:// loading in production
  publicDir: '../public',
  build: { outDir: '../dist', emptyOutDir: true },
  server: { port: 5178, strictPort: true },
});
