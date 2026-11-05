import { defineConfig } from 'vite';
import pwa from './scripts/pwa.mjs';

export default defineConfig(({ mode }) => ({
  plugins: mode === 'pwa' ? [pwa()] : [],
  server: { proxy: { '/api': 'http://127.0.0.1:4318', '/socket': { target: 'ws://127.0.0.1:4318', ws: true } } },
  build: { outDir: mode === 'mobile' ? 'dist-mobile' : 'dist', target: ['mobile', 'pwa'].includes(mode) ? ['safari16', 'chrome100'] : 'chrome130', sourcemap: false },
}));
