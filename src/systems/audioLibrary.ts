/**
 * Catálogo de áudio do jogo.
 *
 * As pastas em `public/assets/audio` são a fonte da verdade: `scripts/audioManifest.mjs`
 * escreve `manifest.json` com todos os arquivos encontrados e as regras abaixo traduzem
 * cada caminho em uma categoria. Para adicionar música ou efeito novo basta soltar o
 * arquivo na pasta correspondente — nada precisa ser escrito em código.
 */

export type AudioBus = 'music' | 'fx' | 'voice';

/** Personagens masculinos e femininos têm vocalizações próprias; `any` serve aos dois. */
export type VoiceGender = 'male' | 'female';
export type ClipGender = VoiceGender | 'any';

export interface AudioClip {
  path: string;
  category: string;
  rare: boolean;
  /** Para qual personagem este arquivo serve, lido do nome do arquivo. */
  gender: ClipGender;
}

export interface CategoryConfig {
  bus: AudioBus;
  /** Intervalo aleatório (ms) entre duas execuções seguidas da mesma categoria. */
  gapMs: [number, number];
  /** Piso absoluto (ms) entre execuções, mesmo quando disparada por evento. */
  cooldownMs: number;
  /** Variação de afinação aplicada a cada execução (fração de ±). */
  pitch: number;
  volume: number;
  fadeInMs: number;
  fadeOutMs: number;
  /** Chance de escolher um arquivo marcado como "rare" no nome. */
  rareChance: number;
  /**
   * Categorias com o mesmo grupo nunca soam juntas: enquanto uma toca, as outras
   * esperam. Evita, por exemplo, dois sons de fome sobrepostos.
   */
  group?: string;
}

export const MUSIC_MENU = 'music:menu';
export const MUSIC_LOBBY = 'music:lobby';
export const MUSIC_HIGH_THREAT = 'music:high-threat';
export const MUSIC_CHASE = 'music:chase';
export const MUSIC_AMBIENT = 'music:ambient';
export const FX_SAFE_ROOM = 'fx:safe-room';
export const FX_PANIC_ATTACK = 'fx:panic-attack';
export const FX_ANXIETY = 'fx:anxiety';
export const FX_HUNGER = 'fx:hunger';
export const FX_HUNGER_LOW = 'fx:hunger-low';
export const FX_THIRST = 'fx:thirst';
export const FX_THIRST_LOW = 'fx:thirst-low';
export const FX_LOW_HEALTH = 'fx:low-health';
export const FX_HURT = 'fx:hurt';
export const FX_SCREAM = 'fx:scream';
export const FX_AMBIENT = 'fx:ambient';

/** Grupo das vocalizações do personagem: só uma por vez. */
export const VOICE_GROUP = 'voz-do-personagem';
/** Grupo dos batimentos cardíacos: vida baixa e dano não se empilham. */
export const HEARTBEAT_GROUP = 'batimentos';

const MUSIC_DEFAULT: CategoryConfig = { bus: 'music', gapMs: [14000, 42000], cooldownMs: 6000, pitch: 0.02, volume: 0.78, fadeInMs: 2200, fadeOutMs: 2600, rareChance: 0.01 };
const FX_DEFAULT: CategoryConfig = { bus: 'fx', gapMs: [38000, 92000], cooldownMs: 12000, pitch: 0.05, volume: 0.8, fadeInMs: 40, fadeOutMs: 520, rareChance: 0.01 };

const config = (base: CategoryConfig, overrides: Partial<CategoryConfig>): CategoryConfig => ({ ...base, ...overrides });

/**
 * Quanto o espaçamento das vocalizações foi esticado em relação ao ajuste original.
 * O personagem fala muito menos: três vezes mais tempo entre cada som da própria voz.
 */
export const VOICE_SPACING_FACTOR = 3;

/**
 * Vocalização do personagem: entra no barramento de voz, no grupo exclusivo da voz
 * e com o espaçamento multiplicado por `VOICE_SPACING_FACTOR`.
 */
const voice = (overrides: Partial<CategoryConfig>): CategoryConfig => {
  const merged = config(FX_DEFAULT, overrides);
  const [min, max] = merged.gapMs;
  return {
    ...merged,
    bus: 'voice',
    group: VOICE_GROUP,
    gapMs: [min * VOICE_SPACING_FACTOR, max * VOICE_SPACING_FACTOR],
    cooldownMs: merged.cooldownMs * VOICE_SPACING_FACTOR,
  };
};

export const CATEGORY_CONFIG: Record<string, CategoryConfig> = {
  [MUSIC_MENU]: config(MUSIC_DEFAULT, { gapMs: [6000, 18000], volume: 0.82 }),
  [MUSIC_LOBBY]: config(MUSIC_DEFAULT, { gapMs: [12000, 40000], volume: 0.74 }),
  [MUSIC_HIGH_THREAT]: config(MUSIC_DEFAULT, { gapMs: [5000, 16000], volume: 0.86, fadeInMs: 900, fadeOutMs: 1600 }),
  [MUSIC_CHASE]: config(MUSIC_DEFAULT, { gapMs: [3000, 9000], volume: 0.9, fadeInMs: 500, fadeOutMs: 1200 }),
  [MUSIC_AMBIENT]: MUSIC_DEFAULT,
  [FX_SAFE_ROOM]: voice({ gapMs: [45000, 120000], cooldownMs: 45000, pitch: 0.045, volume: 0.72, fadeOutMs: 700 }),
  [FX_PANIC_ATTACK]: voice({ gapMs: [25000, 70000], cooldownMs: 22000, pitch: 0.04, volume: 0.92, fadeOutMs: 900 }),
  [FX_ANXIETY]: voice({ gapMs: [26000, 70000], cooldownMs: 16000, volume: 0.76 }),
  // Fome e sede: volume 20% menor do que o ajuste anterior.
  [FX_HUNGER]: voice({ gapMs: [52000, 115000], cooldownMs: 24000, volume: 0.528 }),
  [FX_HUNGER_LOW]: voice({ gapMs: [26000, 62000], cooldownMs: 18000, volume: 0.608 }),
  [FX_THIRST]: voice({ gapMs: [48000, 108000], cooldownMs: 24000, volume: 0.66 }),
  [FX_THIRST_LOW]: voice({ gapMs: [24000, 58000], cooldownMs: 18000, volume: 0.76 }),
  // Batimentos: volume 15% menor do que o ajuste anterior.
  [FX_LOW_HEALTH]: config(FX_DEFAULT, { gapMs: [19000, 44000], cooldownMs: 14000, pitch: 0.035, volume: 0.595, group: HEARTBEAT_GROUP }),
  [FX_HURT]: config(FX_DEFAULT, { gapMs: [9000, 22000], cooldownMs: 7000, pitch: 0.045, volume: 0.748, fadeOutMs: 800, group: HEARTBEAT_GROUP }),
  [FX_SCREAM]: voice({ gapMs: [95000, 260000], cooldownMs: 75000, pitch: 0.06, volume: 0.84, fadeOutMs: 900 }),
  [FX_AMBIENT]: FX_DEFAULT,
};

/** Espaço mínimo (ms) entre dois efeitos quaisquer, contado a partir do fim do anterior. */
export const GLOBAL_FX_SPACING_MS = 2400;

/**
 * Enquanto a duração real de um arquivo não é conhecida, este valor reserva a janela
 * em que nenhum outro efeito pode entrar. Depois do primeiro carregamento o sistema
 * passa a usar a duração verdadeira.
 */
export const ESTIMATED_CLIP_MS = 3200;

export const configFor = (category: string): CategoryConfig =>
  CATEGORY_CONFIG[category] ?? (category.startsWith('music:') ? MUSIC_DEFAULT : FX_DEFAULT);

export const isMusicCategory = (category: string): boolean => configFor(category).bus === 'music';

/** Vocalizações do personagem têm o próprio controle de volume nas configurações. */
export const isVoiceCategory = (category: string): boolean => configFor(category).bus === 'voice';

const AUDIO_PREFIX = '/assets/audio/';

/**
 * Ganho por arquivo, aplicado sobre o volume da categoria. Serve para equilibrar
 * faixas específicas sem mexer no resto da categoria.
 */
const CLIP_GAIN: ReadonlyArray<readonly [RegExp, number]> = [
  // A trilha de lâmpadas do lobby soa 20% mais alta.
  [/lobby_lights/i, 1.2],
  // A música do lobby soa 5% mais baixa.
  [/lobby_song/i, 0.95],
];

export const clipGain = (path: string): number => {
  const name = path.split('/').pop() ?? '';
  return CLIP_GAIN.find(([pattern]) => pattern.test(name))?.[1] ?? 1;
};

const FEMALE_PATTERN = /(^|[^a-z])(female|fem|woman|women|girl|she)([^a-z]|$)/i;
const MALE_PATTERN = /(^|[^a-z])(male|man|men|boy|masc|he)([^a-z]|$)/i;

/**
 * Para qual personagem o arquivo serve, lido do nome: os efeitos gravados dizem no
 * próprio nome se são de voz masculina, feminina ou servem aos dois.
 * `female` é testado primeiro porque "woman" contém "man".
 */
export const clipGenderOf = (path: string): ClipGender => {
  const name = path.split('/').pop() ?? '';
  if (FEMALE_PATTERN.test(name)) return 'female';
  if (MALE_PATTERN.test(name)) return 'male';
  return 'any';
};

/**
 * Arquivos que o personagem atual pode usar: os do próprio gênero mais os neutros.
 * Quando nenhum arquivo do gênero existe, devolve a lista inteira em vez de silêncio.
 */
export const clipsForGender = (clips: readonly AudioClip[], gender: VoiceGender): AudioClip[] => {
  const matching = clips.filter((clip) => clip.gender === gender || clip.gender === 'any');
  return matching.length > 0 ? matching : [...clips];
};

/** Pastas antigas de ansiedade por nível: ignoradas caso os arquivos voltem a aparecer. */
const RETIRED_ANXIETY_FOLDERS = /^fx\/anxiety\/lv\d/;

/**
 * Só tocam os arquivos de `FX` e `Music`. Qualquer outra pasta dentro de
 * `assets/audio` fica guardada para uso futuro e nunca entra no jogo.
 */
export const categoryOf = (path: string): string | null => {
  if (!path.startsWith(AUDIO_PREFIX)) return null;
  const relative = path.slice(AUDIO_PREFIX.length);
  const lower = relative.toLowerCase();
  const name = lower.split('/').pop() ?? '';

  if (lower.startsWith('music/')) {
    if (lower.startsWith('music/menu/')) return MUSIC_MENU;
    if (lower.startsWith('music/high threat/')) return MUSIC_HIGH_THREAT;
    if (lower.startsWith('music/monster chase/')) return MUSIC_CHASE;
    if (lower.startsWith('music/ambient/lv0_lobby/')) return MUSIC_LOBBY;
    return MUSIC_AMBIENT;
  }
  if (lower.startsWith('fx/')) {
    if (RETIRED_ANXIETY_FOLDERS.test(lower)) return null;
    if (lower.startsWith('fx/anxiety/')) {
      if (name.includes('safe_room') || name.includes('safe room')) return FX_SAFE_ROOM;
      if (name.includes('panicattack') || name.includes('panic_attack') || name.includes('panic attack')) return FX_PANIC_ATTACK;
      return FX_ANXIETY;
    }
    if (lower.startsWith('fx/hunger/')) return name.startsWith('hunger_low') || name.includes('_low_') ? FX_HUNGER_LOW : FX_HUNGER;
    if (lower.startsWith('fx/thirst/')) return name.startsWith('thirst_low') || name.includes('_low_') ? FX_THIRST_LOW : FX_THIRST;
    if (lower.startsWith('fx/low health/')) return FX_LOW_HEALTH;
    if (lower.startsWith('fx/getting hurt/')) return FX_HURT;
    if (lower.startsWith('fx/screams/')) return FX_SCREAM;
    return FX_AMBIENT;
  }
  return null;
};

/** READ_ME.txt dos efeitos: arquivos marcados como "rare" devem tocar muito raramente. */
export const isRareClip = (path: string): boolean => /(^|[^a-z])rare([^a-z]|$)/i.test(path.split('/').pop() ?? '');

/** Mesmo som exportado em dois formatos: só o primeiro entra na biblioteca. */
const withoutExtension = (path: string): string => path.replace(/\.[a-z0-9]+$/i, '').toLowerCase();

export const buildLibrary = (paths: readonly string[]): Map<string, AudioClip[]> => {
  const library = new Map<string, AudioClip[]>();
  const seen = new Set<string>();
  for (const path of paths) {
    const category = categoryOf(path);
    if (!category) continue;
    const key = withoutExtension(path);
    if (seen.has(key)) continue;
    seen.add(key);
    const clips = library.get(category) ?? [];
    clips.push({ path, category, rare: isRareClip(path), gender: clipGenderOf(path) });
    library.set(category, clips);
  }
  return library;
};

const LEVEL_ZERO_PATTERN = /(n[ií]vel|level|lv)[\s_-]*0(?![0-9])/i;

/** Qualquer sala do nível 0 — pelo nome do nível, pelo código da sala ou pela pasta da imagem. */
export const isLevelZero = (...hints: Array<string | undefined>): boolean =>
  hints.some((hint) => {
    if (!hint) return false;
    if (LEVEL_ZERO_PATTERN.test(hint)) return true;
    return /00_nivel_0|lv0_|_lobby|\blobby\b/i.test(hint);
  });

/**
 * Sorteia o próximo arquivo de uma categoria com duas regras:
 * arquivos marcados como "rare" só entram com a chance mínima e nenhum arquivo
 * toca mais de duas vezes seguidas quando existe alternativa.
 */
export const selectClip = (
  clips: readonly AudioClip[],
  history: readonly string[],
  config: CategoryConfig,
  random: () => number = Math.random,
): AudioClip | null => {
  if (clips.length === 0) return null;
  const rare = clips.filter((clip) => clip.rare);
  const common = clips.filter((clip) => !clip.rare);
  const pool = rare.length > 0 && common.length > 0 && random() < config.rareChance ? rare : (common.length > 0 ? common : rare);
  if (pool.length === 0) return null;
  const draw = (): AudioClip => pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]!;
  const last = history[history.length - 1];
  const blocked = history.length >= 2 && last !== undefined && last === history[history.length - 2] ? last : null;
  let clip = draw();
  for (let attempt = 0; attempt < 6 && pool.length > 1; attempt += 1) {
    if (clip.path !== blocked && !(attempt === 0 && clip.path === last)) break;
    clip = draw();
  }
  if (clip.path === blocked) clip = pool.find((candidate) => candidate.path !== blocked) ?? clip;
  return clip;
};
