import { EDITOR_STORAGE_KEY, SANDBOX, SAVE_STORAGE_KEY } from '../config/storage';

/**
 * A cópia local do projeto, mantida em disco dentro do repositório.
 *
 * O editor e o jogo vivem no `localStorage`: ele é rápido e não precisa de servidor,
 * mas está trancado dentro de um navegador. Nenhuma outra sessão de trabalho — nem o
 * Git — vê o que há lá dentro, então um mapa editado hoje desaparecia do repositório.
 *
 * Em desenvolvimento, `scripts/localSync.mjs` abre `/__local/...` no servidor do Vite
 * e este módulo é o outro lado da ponte: ao abrir, o navegador puxa o que está em
 * `data/` e fica com a versão mais recente; a cada gravação, empurra de volta. O
 * arquivo em disco é a cópia que qualquer conversa nova lê, e é ele que sobe para a
 * `main`.
 *
 * Fora do servidor de desenvolvimento nada disto acontece — todas as funções saem
 * caladas e o jogo continua inteiro no `localStorage`. No modo isolado (`?isolado`)
 * também não: lá o trabalho é descartável de propósito e não deve chegar ao disco.
 */

type SyncFile = 'project' | 'progress';

const STORAGE_KEYS: Readonly<Record<SyncFile, string>> = {
  project: EDITOR_STORAGE_KEY,
  progress: SAVE_STORAGE_KEY,
};

/** Espera depois da última gravação antes de escrever em disco, para não escrever a cada tecla. */
const WRITE_DELAY_MS = 700;

/**
 * A ponte só existe num navegador rodando o servidor de desenvolvimento. Nos testes e
 * no build estático não há `window` nem servidor, e tudo aqui vira um gesto vazio.
 */
const available = (): boolean => !SANDBOX
  && typeof window !== 'undefined'
  && typeof fetch === 'function'
  && typeof import.meta !== 'undefined'
  && import.meta.env?.DEV === true;

const timers: Partial<Record<SyncFile, number>> = {};
const pending: Partial<Record<SyncFile, unknown>> = {};

/** Quando aquele conteúdo foi atualizado, pelo carimbo que ele mesmo carrega. */
const stampOf = (value: unknown): number => {
  const raw = (value as { updatedAt?: unknown } | null)?.updatedAt;
  const time = typeof raw === 'string' ? Date.parse(raw) : NaN;
  return Number.isFinite(time) ? time : 0;
};

const readLocal = (file: SyncFile): unknown => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS[file]);
    return raw ? JSON.parse(raw) as unknown : null;
  } catch { return null; }
};

const writeLocal = (file: SyncFile, value: unknown): void => {
  try { localStorage.setItem(STORAGE_KEYS[file], JSON.stringify(value)); } catch { /* sem espaço: segue com o que há */ }
};

const fetchDisk = async (file: SyncFile): Promise<unknown> => {
  try {
    const response = await fetch(`/__local/${file}`, { cache: 'no-store' });
    return response.ok ? await response.json() as unknown : null;
  } catch { return null; }
};

const writeDisk = async (file: SyncFile, value: unknown): Promise<void> => {
  try {
    await fetch(`/__local/${file}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value),
    });
  } catch { /* sem servidor de desenvolvimento a cópia em disco simplesmente não muda */ }
};

/**
 * Manda o conteúdo para o disco um instante depois da última chamada. O editor grava
 * a cada letra digitada em um campo; sem a espera, cada uma viraria uma escrita.
 */
export const syncToDisk = (file: SyncFile, value: unknown): void => {
  if (!available()) return;
  pending[file] = value;
  window.clearTimeout(timers[file]);
  timers[file] = window.setTimeout(() => {
    const payload = pending[file];
    delete pending[file];
    if (payload !== undefined) void writeDisk(file, payload);
  }, WRITE_DELAY_MS);
};

/** Escreve agora o que estiver esperando, sem a espera — para o fechamento da aba. */
export const flushToDisk = async (): Promise<void> => {
  if (!available()) return;
  const files = Object.keys(pending) as SyncFile[];
  await Promise.all(files.map((file) => {
    const payload = pending[file];
    delete pending[file];
    window.clearTimeout(timers[file]);
    return payload === undefined ? Promise.resolve() : writeDisk(file, payload);
  }));
};

/**
 * Acerta o navegador com o disco antes de o aplicativo nascer: fica com a versão de
 * carimbo mais novo dos dois lados. Assim a aba continua de onde a cópia local parou
 * — inclusive quando a cópia local foi atualizada por fora, por um `git pull`.
 */
export const pullFromDisk = async (file: SyncFile): Promise<void> => {
  if (!available()) return;
  const [disk, local] = [await fetchDisk(file), readLocal(file)];
  if (!disk) {
    // Primeira vez: o disco ainda não tem nada e o navegador semeia o arquivo.
    if (local) syncToDisk(file, local);
    return;
  }
  if (stampOf(disk) > stampOf(local)) writeLocal(file, disk);
  else if (local && stampOf(local) > stampOf(disk)) syncToDisk(file, local);
};

/** Acerta mapa e progresso de uma vez, na abertura da página. */
export const pullAllFromDisk = async (): Promise<void> => {
  await Promise.all([pullFromDisk('project'), pullFromDisk('progress')]);
};

export interface PushResult {
  ok: boolean;
  /** Falso quando não havia nada novo em `data/` para enviar. */
  pushed?: boolean;
  output: string;
}

/** Commita `data/` e envia para a `main`. Só o que está em `data/` entra no commit. */
export const pushToRepository = async (message?: string): Promise<PushResult> => {
  if (!available()) return { ok: false, output: 'O envio só existe no servidor de desenvolvimento.' };
  await flushToDisk();
  try {
    const response = await fetch('/__local/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const payload = await response.json() as PushResult;
    return { ok: response.ok && payload.ok !== false, pushed: payload.pushed, output: payload.output ?? '' };
  } catch (error) {
    return { ok: false, output: String((error as Error)?.message ?? error) };
  }
};

export const localSyncAvailable = available;
