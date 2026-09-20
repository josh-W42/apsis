// defineConfig comes from vitest/config, not vite — vite's own defineConfig
// has no `test` key and will fail typecheck.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 5173 is taken by sift-web on this machine.
  server: { port: 5174, strictPort: true },
  worker: { format: 'es' },

  // satellite.js's emscripten builds use top-level await, which is ES2022.
  // Vite's default target is es2020, and the dep optimizer fails on it —
  // including for the pthreads build we never call, because the optimizer
  // still parses every entry in the package's `imports` map.
  build: { target: 'es2022' },
  esbuild: { target: 'es2022' },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },

  test: { environment: 'node' },
});
