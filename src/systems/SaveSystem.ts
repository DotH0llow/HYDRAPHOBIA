import { validateCharacter } from '../config/character';
import { SAVE_SLOT_COUNT, type CampaignEnding, type CharacterProfile, type GameSave, type InventoryEntry, type Preferences, type RoomId, type SaveData, type SaveSlot } from '../types';

const STORAGE_KEY = 'limiar:save:v3';
/** Chave da versão anterior, lida uma única vez para migrar o progresso antigo. */
const LEGACY_STORAGE_KEY = 'limiar:save:v2';
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const INTEGRITY_SEED = 'limiar:v3:integrity:f4k3r$';
export const DEFAULT_PREFERENCES: Preferences = { masterVolume: 0.72, musicVolume: 0.34, effectsVolume: 0.78, voiceVolume: 0.8, jumpscareIntensity: 0.8, showHealthBar: false };

const emptySlots = (): Array<SaveSlot | null> => Array.from({ length: SAVE_SLOT_COUNT }, () => null);

export const DEFAULT_SAVE: SaveData = { version: 3, updatedAt: '', activeSlot: null, slots: emptySlots(), preferences: DEFAULT_PREFERENCES };

export const createSlot = (character: CharacterProfile): SaveSlot => {
  const now = new Date().toISOString();
  return { character, game: null, createdAt: now, updatedAt: now };
};

/**
 * Fim de campanha, por morte ou por fuga: o registro guarda o personagem e perde o
 * progresso. A morte nunca chega a ser gravada, então sem isto o save fica parado no
 * instante anterior a ela e "Continuar" devolve o jogador para morrer de novo.
 */
export const endCampaign = (save: SaveData, slotIndex: number, ending?: CampaignEnding, at = new Date().toISOString()): boolean => {
  const slot = save.slots[slotIndex];
  if (!slot) return false;
  slot.game = null;
  slot.ending = ending;
  slot.updatedAt = at;
  save.activeSlot = null;
  save.updatedAt = at;
  return true;
};

type SaveStorage = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>;

type PersistedSave = SaveData & { _ic?: string };

/** Formato antigo, com uma campanha só. */
type LegacySave = { version?: number; updatedAt?: string; game?: unknown; preferences?: Partial<Preferences> };

function computeIntegrity(data: SaveData): string {
  const payload = INTEGRITY_SEED + JSON.stringify({ version: data.version, updatedAt: data.updatedAt, slots: data.slots });
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
      if (!raw) return this.migrateLegacy();
      const parsed = JSON.parse(raw) as PersistedSave;
      const validated = this.validate(parsed);
      // Save editado por fora: o progresso cai, as configurações permanecem.
      if (typeof parsed._ic === 'string' && parsed._ic !== computeIntegrity(validated)) {
        validated.slots = emptySlots();
        validated.activeSlot = null;
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
      if (this.storage?.removeItem) { this.storage.removeItem(STORAGE_KEY); this.storage.removeItem(LEGACY_STORAGE_KEY); }
      else this.storage?.setItem(STORAGE_KEY, '');
      return this.storage !== null;
    } catch { return false; }
  }

  /** Converte um save da versão 2 (campanha única) no primeiro slot da versão 3. */
  private migrateLegacy(): SaveData {
    const fresh = structuredClone(DEFAULT_SAVE);
    try {
      const raw = this.storage?.getItem(LEGACY_STORAGE_KEY);
      if (!raw) return fresh;
      const legacy = JSON.parse(raw) as LegacySave;
      if (legacy.preferences) fresh.preferences = this.validatePreferences(legacy.preferences);
      const game = this.validateGame(legacy.game);
      if (game) {
        const slot = createSlot(validateCharacter({ name: 'Registro anterior' }));
        slot.game = game;
        slot.createdAt = typeof legacy.updatedAt === 'string' ? legacy.updatedAt : slot.createdAt;
        slot.updatedAt = slot.createdAt;
        fresh.slots[0] = slot;
      }
      this.save(fresh);
      return fresh;
    } catch { return fresh; }
  }

  private validate(value: unknown): SaveData {
    if (!value || typeof value !== 'object') return structuredClone(DEFAULT_SAVE);
    const raw = value as Partial<SaveData>;
    const rawSlots = Array.isArray(raw.slots) ? raw.slots : [];
    const slots = Array.from({ length: SAVE_SLOT_COUNT }, (_, index) => this.validateSlot(rawSlots[index]));
    const requested = typeof raw.activeSlot === 'number' && Number.isInteger(raw.activeSlot) ? raw.activeSlot : -1;
    return {
      version: 3,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
      activeSlot: requested >= 0 && requested < SAVE_SLOT_COUNT && slots[requested] ? requested : null,
      slots,
      preferences: this.validatePreferences(raw.preferences),
    };
  }

  private validatePreferences(value: Partial<Preferences> | undefined): Preferences {
    const prefs = value ?? DEFAULT_PREFERENCES;
    return {
      masterVolume: this.number(prefs.masterVolume, 0, 1, DEFAULT_PREFERENCES.masterVolume),
      musicVolume: this.number(prefs.musicVolume, 0, 1, DEFAULT_PREFERENCES.musicVolume),
      effectsVolume: this.number(prefs.effectsVolume, 0, 1, DEFAULT_PREFERENCES.effectsVolume),
      voiceVolume: this.number(prefs.voiceVolume, 0, 1, DEFAULT_PREFERENCES.voiceVolume),
      jumpscareIntensity: this.number(prefs.jumpscareIntensity, 0, 1, DEFAULT_PREFERENCES.jumpscareIntensity),
      showHealthBar: typeof prefs.showHealthBar === 'boolean' ? prefs.showHealthBar : DEFAULT_PREFERENCES.showHealthBar,
    };
  }

  private validateSlot(value: unknown): SaveSlot | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Partial<SaveSlot>;
    const character = validateCharacter(raw.character);
    const timestamp = (candidate: unknown): string => typeof candidate === 'string' ? candidate : '';
    return {
      character,
      game: this.validateGame(raw.game),
      createdAt: timestamp(raw.createdAt),
      updatedAt: timestamp(raw.updatedAt),
      ending: this.validateEnding(raw.ending),
    };
  }

  /** Registro gravado antes de o fim existir, ou editado por fora: simplesmente não tem fim. */
  private validateEnding(value: unknown): CampaignEnding | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const raw = value as Partial<CampaignEnding>;
    if (raw.kind !== 'death' && raw.kind !== 'escape') return undefined;
    return {
      kind: raw.kind,
      room: typeof raw.room === 'string' ? raw.room.slice(0, 80) : '',
      roomId: typeof raw.roomId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(raw.roomId) ? raw.roomId : '',
      elapsed: this.number(raw.elapsed, 0, 10000000, 0),
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
