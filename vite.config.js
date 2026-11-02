import { defineConfig } from 'vite';

export default defineConfig({
  server: { proxy: { '/api': 'http://127.0.0.1:4318', '/socket': { target: 'ws://127.0.0.1:4318', ws: true } } },
  build: { outDir: 'dist', target: 'chrome130', sourcemap: false },
});
