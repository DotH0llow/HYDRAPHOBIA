import { defineConfig } from 'vite';
import { audioManifestPlugin } from './scripts/audioManifest.mjs';

export default defineConfig({
  base: '/',
  plugins: [audioManifestPlugin()],
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
