import { exec } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/**
 * Ponte entre o navegador e a cópia local do repositório, só no servidor de
 * desenvolvimento.
 *
 * O editor e o jogo guardam tudo em `localStorage`, que mora dentro do navegador e
 * some de vista assim que a aba fecha: nenhuma outra sessão de trabalho — nem o Git —
 * enxerga aquilo. Este plugin dá ao navegador um lugar em disco dentro do próprio
 * repositório, `data/`, para onde cada gravação do editor e cada avanço do jogo são
 * copiados na hora. Assim a cópia local fica sempre atualizada, qualquer conversa
 * nova lê o mapa e o progresso direto dos arquivos, e o que foi editado pode subir
 * para a `main` com um commit.
 *
 * Em produção nada disto existe: o build é estático e o jogo continua inteiro no
 * `localStorage`.
 */

const run = promisify(exec);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = join(ROOT, 'data');

/** Os dois arquivos que o navegador pode ler e escrever, e nada além deles. */
const FILES = {
  project: 'project.json',
  progress: 'progress.json',
};

const readBody = (request) => new Promise((resolveBody, rejectBody) => {
  const chunks = [];
  let size = 0;
  request.on('data', (chunk) => {
    size += chunk.length;
    // Um mapa com imagens embutidas em base64 cresce rápido; acima disso é engano.
    if (size > 64 * 1024 * 1024) { rejectBody(new Error('corpo grande demais')); request.destroy(); return; }
    chunks.push(chunk);
  });
  request.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
  request.on('error', rejectBody);
});

const send = (response, status, payload) => {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.end(JSON.stringify(payload));
};

/** `git` com a saída junta, para o editor poder mostrar o que aconteceu. */
const git = async (command) => {
  try {
    const { stdout, stderr } = await run(`git ${command}`, { cwd: ROOT, maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, output: `${stdout}${stderr}`.trim() };
  } catch (error) {
    return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? error.message ?? ''}`.trim() };
  }
};

/**
 * Commita e envia só o que está em `data/`. O resto da árvore fica de fora de
 * propósito: o editor não deve levar junto código pela metade que esteja aberto.
 */
const pushData = async (message) => {
  const add = await git('add -- data');
  if (!add.ok) return { ok: false, step: 'add', output: add.output };
  const staged = await git('diff --cached --quiet -- data');
  // `--quiet` sai com 1 quando há diferença: é esse o caso em que há o que commitar.
  if (staged.ok) return { ok: true, pushed: false, output: 'Nada novo em data/ para enviar.' };
  const subject = (message || 'chore(editor): sincroniza o mapa e o progresso locais').replace(/["\n\r]/g, ' ').slice(0, 120);
  const commit = await git(`commit -m "${subject}" -- data`);
  if (!commit.ok) return { ok: false, step: 'commit', output: commit.output };
  const push = await git('push origin HEAD:main');
  if (!push.ok) return { ok: false, step: 'push', output: push.output };
  return { ok: true, pushed: true, output: `${commit.output}\n${push.output}`.trim() };
};

export const localSyncPlugin = () => ({
  name: 'hydraphobia-local-sync',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      const url = (request.url ?? '').split('?')[0];
      if (!url.startsWith('/__local/')) { next(); return; }
      const name = url.slice('/__local/'.length);

      if (name === 'push') {
        if (request.method !== 'POST') return send(response, 405, { error: 'método inválido' });
        let message = '';
        try { message = JSON.parse(await readBody(request) || '{}').message ?? ''; } catch { /* mensagem padrão */ }
        const result = await pushData(message);
        return send(response, result.ok ? 200 : 500, result);
      }

      const file = FILES[name];
      if (!file) { next(); return; }
      const path = join(DATA_DIR, file);

      if (request.method === 'GET') {
        try {
          return send(response, 200, JSON.parse(await readFile(path, 'utf8')));
        } catch {
          return send(response, 404, { error: 'ainda não existe' });
        }
      }

      if (request.method === 'PUT' || request.method === 'POST') {
        try {
          const body = await readBody(request);
          // Passa pelo JSON antes de gravar: um corpo quebrado nunca vira arquivo.
          const data = JSON.parse(body);
          await mkdir(DATA_DIR, { recursive: true });
          await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
          return send(response, 200, { ok: true });
        } catch (error) {
          return send(response, 400, { error: String(error?.message ?? error) });
        }
      }

      return send(response, 405, { error: 'método inválido' });
    });
  },
});

export default localSyncPlugin;
