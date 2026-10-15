import type { PlayerPreferences, SaveData } from '../types';

const STORAGE_KEY = 'ultima-vigilia:save:v1';
export const DEFAULT_PREFERENCES: PlayerPreferences = { volume: 0.65, muted: false, reducedMotion: false, reducedFlashes: false };
export const DEFAULT_SAVE: SaveData = { version: 1, unlockedNight: 1, completedNights: [], bestResults: {}, preferences: DEFAULT_PREFERENCES };

export class SaveSystem {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage) {}

  load(): SaveData {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(DEFAULT_SAVE);
      return this.validate(JSON.parse(raw) as unknown);
    } catch { return structuredClone(DEFAULT_SAVE); }
  }

  save(data: SaveData): boolean {
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.validate(data))); return this.storage !== null; }
    catch { return false; }
  }

  completeNight(data: SaveData, night: number, energy: number): SaveData {
    const completed = Array.from(new Set([...data.completedNights, night])).sort();
    const next: SaveData = {
      ...data,
      completedNights: completed,
      unlockedNight: Math.max(data.unlockedNight, Math.min(3, night + 1)),
      bestResults: { ...data.bestResults },
    };
    const previous = data.bestResults[night];
    if (!previous || energy > previous.energy) next.bestResults[night] = { energy, completedAt: new Date().toISOString() };
    this.save(next);
    return next;
  }

  private validate(value: unknown): SaveData {
    if (!value || typeof value !== 'object') return structuredClone(DEFAULT_SAVE);
    const raw = value as Partial<SaveData>;
    const prefs = raw.preferences ?? DEFAULT_PREFERENCES;
    return {
      version: 1,
      unlockedNight: this.integer(raw.unlockedNight, 1, 3, 1),
      completedNights: Array.isArray(raw.completedNights) ? raw.completedNights.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= 3) : [],
      bestResults: this.validateResults(raw.bestResults),
      preferences: {
        volume: this.number(prefs.volume, 0, 1, DEFAULT_PREFERENCES.volume),
        muted: typeof prefs.muted === 'boolean' ? prefs.muted : false,
        reducedMotion: typeof prefs.reducedMotion === 'boolean' ? prefs.reducedMotion : false,
        reducedFlashes: typeof prefs.reducedFlashes === 'boolean' ? prefs.reducedFlashes : false,
      },
    };
  }

  private number(value: unknown, min: number, max: number, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  }
  private integer(value: unknown, min: number, max: number, fallback: number): number {
    return typeof value === 'number' && Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : fallback;
  }

  private validateResults(value: unknown): SaveData['bestResults'] {
    if (!value || typeof value !== 'object') return {};
    const results: SaveData['bestResults'] = {};
    for (const night of [1, 2, 3]) {
      const entry = (value as Record<number, unknown>)[night];
      if (!entry || typeof entry !== 'object') continue;
      const candidate = entry as { energy?: unknown; completedAt?: unknown };
      if (typeof candidate.energy === 'number' && Number.isFinite(candidate.energy) && typeof candidate.completedAt === 'string') {
        results[night] = { energy: this.number(candidate.energy, 0, 100, 0), completedAt: candidate.completedAt };
      }
    }
    return results;
  }
}
