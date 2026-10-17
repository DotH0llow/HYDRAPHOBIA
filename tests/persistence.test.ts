import { describe, expect, it } from 'vitest';
import { DEFAULT_SAVE, SaveSystem } from '../src/systems/SaveSystem';

class MemoryStorage {
  value: string | null = null;
  getItem(): string | null { return this.value; }
  setItem(_key: string, value: string): void { this.value = value; }
  removeItem(): void { this.value = null; }
}

describe('SaveSystem', () => {
  it('salva e restaura progresso e configurações', () => {
    const storage = new MemoryStorage();
    const saves = new SaveSystem(storage);
    const data = structuredClone(DEFAULT_SAVE);
    data.preferences.masterVolume = 0.2;
    data.game = {
      position: 'floodedRoom', stats: { health: 80, hunger: 60, thirst: 40, anxiety: 15 },
      inventory: [{ id: 'fuse', quantity: 1 }], flags: { maintenanceUnlocked: true },
      discovered: ['reception', 'floodedRoom'], moveCount: 5, elapsed: 92,
      danger: 8, roomTime: { floodedRoom: 42 },
    };
    expect(saves.save(data)).toBe(true);
    expect(saves.load()).toEqual(data);
  });

  it('recupera dados corrompidos sem quebrar', () => {
    const storage = new MemoryStorage();
    storage.value = '{inválido';
    expect(new SaveSystem(storage).load()).toEqual(DEFAULT_SAVE);
  });

  it('valida limites e remove itens com formato inválido', () => {
    const storage = new MemoryStorage();
    storage.value = JSON.stringify({
      version: 99, updatedAt: 42,
      preferences: { masterVolume: 8, musicVolume: -2, effectsVolume: 0.5, jumpscareIntensity: 3 },
      game: {
        position: 'reception', stats: { health: 900, hunger: -5, thirst: 50, anxiety: -10 },
        inventory: [{ id: 'item com espaço', quantity: 4 }, { id: 'ration', quantity: 50 }, { id: 'customItem', quantity: 2 }],
        flags: { ok: true, bad: 'yes' }, discovered: ['reception', 'void'], moveCount: -4, elapsed: 20,
      },
    });
    const restored = new SaveSystem(storage).load();
    expect(restored.version).toBe(2);
    expect(restored.preferences.masterVolume).toBe(1);
    expect(restored.preferences.musicVolume).toBe(0);
    expect(restored.game?.stats.health).toBe(100);
    expect(restored.game?.stats.hunger).toBe(0);
    expect(restored.game?.stats.anxiety).toBe(0);
    expect(restored.game?.inventory).toEqual([{ id: 'ration', quantity: 9 }, { id: 'customItem', quantity: 2 }]);
    expect(restored.game?.discovered).toEqual(['reception', 'void']);
  });

  it('apaga o save local', () => {
    const storage = new MemoryStorage();
    const saves = new SaveSystem(storage);
    saves.save(structuredClone(DEFAULT_SAVE));
    expect(saves.clear()).toBe(true);
    expect(storage.value).toBeNull();
  });
});
