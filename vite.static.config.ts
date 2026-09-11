import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: process.env.TOOLBOX_BASE_PATH || './',
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  build: { outDir: 'dist', sourcemap: false },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
