import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the build works on the custom domain and on a /repo/ path.
  base: './',
  server: { port: 5174, strictPort: true },
});
