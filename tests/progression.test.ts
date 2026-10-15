import { describe, expect, it } from 'vitest';
import { DEFAULT_SAVE, SaveSystem } from '../src/systems/SaveSystem';

class MemoryStorage {
  value: string | null = null;
  getItem(): string | null { return this.value; }
  setItem(_key: string, value: string): void { this.value = value; }
}

describe('progressão', () => {
  it('desbloqueia a próxima noite e preserva o melhor resultado', () => {
    const storage = new MemoryStorage();
    const saves = new SaveSystem(storage);
    const first = saves.completeNight(structuredClone(DEFAULT_SAVE), 1, 42);
    expect(first.unlockedNight).toBe(2);
    expect(first.completedNights).toEqual([1]);
    const worse = saves.completeNight(first, 1, 20);
    expect(worse.bestResults[1]?.energy).toBe(42);
    expect(saves.load().unlockedNight).toBe(2);
  });

  it('recupera armazenamento corrompido com valores padrão', () => {
    const storage = new MemoryStorage();
    storage.value = '{não é json';
    const restored = new SaveSystem(storage).load();
    expect(restored.unlockedNight).toBe(1);
    expect(restored.preferences.volume).toBeGreaterThan(0);
  });

  it('valida preferências e resultados fora dos limites', () => {
    const storage = new MemoryStorage();
    storage.value = JSON.stringify({
      version: 99,
      unlockedNight: 500,
      completedNights: [1, 99, '2'],
      bestResults: { 1: { energy: 900, completedAt: 'hoje' }, 2: 'inválido' },
      preferences: { volume: -2, muted: 'sim', reducedMotion: true },
    });
    const restored = new SaveSystem(storage).load();
    expect(restored.version).toBe(1);
    expect(restored.unlockedNight).toBe(3);
    expect(restored.completedNights).toEqual([1]);
    expect(restored.preferences.volume).toBe(0);
    expect(restored.preferences.muted).toBe(false);
    expect(restored.bestResults[1]?.energy).toBe(100);
  });
});
