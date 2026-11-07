import { defineConfig } from 'vite';

export default defineConfig({
  // Relative paths so the build works at a domain root or in a sub-folder.
  base: './',
  server: { port: 5177 },
  build: { outDir: 'dist', target: 'es2020', chunkSizeWarningLimit: 1200 },
});
