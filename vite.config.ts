import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  resolve: { preserveSymlinks: true },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: {
        game: 'index.html',
        editor: 'editor.html',
      },
    },
  },
});
