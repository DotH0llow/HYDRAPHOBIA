import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const AUDIO_ROOT = 'public/assets/audio';
const MANIFEST_PATH = 'public/assets/audio/manifest.json';
const EXTENSIONS = new Set(['.mp3', '.ogg', '.wav', '.m4a', '.opus', '.flac', '.aac']);

const toPosix = (value) => value.split('\\').join('/');

const extensionOf = (name) => {
  const index = name.lastIndexOf('.');
  return index < 0 ? '' : name.slice(index).toLowerCase();
};

export const collectAudioFiles = (root = AUDIO_ROOT) => {
  if (!existsSync(root)) return [];
  const found = [];
  const walk = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(directory, entry.name), relative);
      else if (EXTENSIONS.has(extensionOf(entry.name))) found.push(`/assets/audio/${toPosix(relative)}`);
    }
  };
  walk(root, '');
  return found.sort((a, b) => a.localeCompare(b));
};

export const writeAudioManifest = ({ root = AUDIO_ROOT, output = MANIFEST_PATH, quiet = false } = {}) => {
  const files = collectAudioFiles(root);
  const payload = `${JSON.stringify({ files }, null, 2)}\n`;
  const previous = existsSync(output) ? readFileSync(output, 'utf8') : '';
  if (previous === payload) return { files, changed: false };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, payload, 'utf8');
  if (!quiet) console.log(`[audio-manifest] ${files.length} arquivos -> ${output}`);
  return { files, changed: true };
};

/** Keeps public/assets/audio/manifest.json in sync while developing and on every build. */
export const audioManifestPlugin = () => ({
  name: 'hydraphobia-audio-manifest',
  buildStart() { writeAudioManifest({ quiet: true }); },
  configureServer(server) {
    writeAudioManifest({ quiet: true });
    const refresh = (file) => {
      if (!toPosix(file).includes('/public/assets/audio/')) return;
      if (toPosix(file).endsWith('/manifest.json')) return;
      if (writeAudioManifest({ quiet: true }).changed) server.ws.send({ type: 'full-reload' });
    };
    server.watcher.on('add', refresh);
    server.watcher.on('unlink', refresh);
  },
});

const invokedDirectly = process.argv[1] && toPosix(process.argv[1]).endsWith('scripts/audioManifest.mjs');
if (invokedDirectly) writeAudioManifest();
