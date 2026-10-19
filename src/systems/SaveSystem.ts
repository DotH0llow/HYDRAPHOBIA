import type { GameSave, InventoryEntry, Preferences, RoomId, SaveData } from '../types';

const STORAGE_KEY = 'limiar:save:v2';
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const INTEGRITY_SEED = 'limiar:v2:integrity:f4k3r$';
export const DEFAULT_PREFERENCES: Preferences = { masterVolume: 0.72, musicVolume: 0.34, effectsVolume: 0.78, jumpscareIntensity: 0.8, showHealthBar: false };
export const DEFAULT_SAVE: SaveData = { version: 2, updatedAt: '', game: null, preferences: DEFAULT_PREFERENCES };

type SaveStorage = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>;

type PersistedSave = SaveData & { _ic?: string };

function computeIntegrity(data: SaveData): string {
  const payload = INTEGRITY_SEED + JSON.stringify({ version: data.version, updatedAt: data.updatedAt, game: data.game });
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export class SaveSystem {
  constructor(private readonly storage: SaveStorage | null = typeof localStorage === 'undefined' ? null : localStorage) {}

  load(): SaveData {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(DEFAULT_SAVE);
      const parsed = JSON.parse(raw) as PersistedSave;
      const validated = this.validate(parsed);
      if (validated.game !== null && typeof parsed._ic === 'string') {
        const expected = computeIntegrity(validated);
        if (parsed._ic !== expected) {
          validated.game = null;
        }
      }
      return validated;
    } catch { return structuredClone(DEFAULT_SAVE); }
  }

  save(data: SaveData): boolean {
    try {
      const validated = this.validate(data);
      const persisted: PersistedSave = { ...validated, _ic: computeIntegrity(validated) };
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(persisted));
      return this.storage !== null;
    }
    catch { return false; }
  }

  clear(): boolean {
    try {
      if (this.storage?.removeItem) this.storage.removeItem(STORAGE_KEY);
      else this.storage?.setItem(STORAGE_KEY, '');
      return this.storage !== null;
    } catch { return false; }
  }

  private validate(value: unknown): SaveData {
    if (!value || typeof value !== 'object') return structuredClone(DEFAULT_SAVE);
    const raw = value as Partial<SaveData>;
    const prefs = raw.preferences ?? DEFAULT_PREFERENCES;
    return {
      version: 2,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
      game: this.validateGame(raw.game),
      preferences: {
        masterVolume: this.number(prefs.masterVolume, 0, 1, DEFAULT_PREFERENCES.masterVolume),
        musicVolume: this.number(prefs.musicVolume, 0, 1, DEFAULT_PREFERENCES.musicVolume),
        effectsVolume: this.number(prefs.effectsVolume, 0, 1, DEFAULT_PREFERENCES.effectsVolume),
        jumpscareIntensity: this.number(prefs.jumpscareIntensity, 0, 1, DEFAULT_PREFERENCES.jumpscareIntensity),
        showHealthBar: typeof prefs.showHealthBar === 'boolean' ? prefs.showHealthBar : DEFAULT_PREFERENCES.showHealthBar,
      },
    };
  }

  private number(value: unknown, min: number, max: number, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  }
  private validateGame(value: unknown): GameSave | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Partial<GameSave>;
    if (typeof raw.position !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(raw.position)) return null;
    const stats = raw.stats && typeof raw.stats === 'object' ? raw.stats : { health: 100, hunger: 100, thirst: 100, anxiety: 0 };
    const inventory: InventoryEntry[] = Array.isArray(raw.inventory)
      ? raw.inventory.filter((entry): entry is InventoryEntry => Boolean(entry && ID_PATTERN.test(String(entry.id)) && Number.isInteger(entry.quantity) && entry.quantity > 0)).map((entry) => ({ id: entry.id, quantity: Math.min(9, entry.quantity) }))
      : [];
    const flags: Record<string, boolean> = {};
    if (raw.flags && typeof raw.flags === 'object') Object.entries(raw.flags).forEach(([key, flag]) => { if (typeof flag === 'boolean') flags[key] = flag; });
    const discovered = Array.isArray(raw.discovered)
      ? raw.discovered.filter((room): room is RoomId => typeof room === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(room))
      : [raw.position];
    const roomTime: Record<RoomId, number> = {};
    if (raw.roomTime && typeof raw.roomTime === 'object') Object.entries(raw.roomTime).forEach(([room, seconds]) => { if (/^[a-zA-Z0-9_-]{1,100}$/.test(room)) roomTime[room] = this.number(seconds, 0, 1000000, 0); });
    return {
      position: raw.position,
      stats: {
        health: this.number(stats.health, 0, 100, 100),
        hunger: this.number(stats.hunger, 0, 100, 100),
        thirst: this.number(stats.thirst, 0, 100, 100),
        anxiety: this.number(stats.anxiety, 0, 100, 0),
      },
      inventory,
      flags,
      discovered: [...new Set(discovered)],
      moveCount: this.number(raw.moveCount, 0, 100000, 0),
      elapsed: this.number(raw.elapsed, 0, 10000000, 0),
      danger: this.number(raw.danger, 0, 100, 0),
      roomTime,
    };
  }
}
