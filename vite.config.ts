import { defineConfig } from 'vite';
import { audioManifestPlugin } from './scripts/audioManifest.mjs';
import { localSyncPlugin } from './scripts/localSync.mjs';

export default defineConfig({
  base: '/',
  plugins: [audioManifestPlugin(), localSyncPlugin()],
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
