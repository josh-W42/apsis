// defineConfig comes from vitest/config, not vite — vite's own defineConfig
// has no `test` key and will fail typecheck.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  test: { environment: 'node' },
});
