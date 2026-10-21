import { describe, expect, it } from 'vitest';
import { createSlot, DEFAULT_PREFERENCES, DEFAULT_SAVE, endCampaign, SaveSystem } from '../src/systems/SaveSystem';
import { DEFAULT_CHARACTER } from '../src/config/character';
import { SAVE_SLOT_COUNT, type GameSave } from '../src/types';

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

const progress = (): GameSave => ({
  position: 'floodedRoom', stats: { health: 80, hunger: 60, thirst: 40, anxiety: 15 },
  inventory: [{ id: 'fuse', quantity: 1 }], flags: { maintenanceUnlocked: true },
  discovered: ['reception', 'floodedRoom'], moveCount: 5, elapsed: 92,
  danger: 8, roomTime: { floodedRoom: 42 },
});

describe('SaveSystem', () => {
  it('guarda quatro registros independentes', () => {
    const storage = new MemoryStorage();
    const saves = new SaveSystem(storage);
    const data = structuredClone(DEFAULT_SAVE);
    expect(data.slots).toHaveLength(SAVE_SLOT_COUNT);

    const first = createSlot({ ...DEFAULT_CHARACTER, name: 'Ana', gender: 'female', classId: 'tecnico' });
    first.game = progress();
    const second = createSlot({ ...DEFAULT_CHARACTER, name: 'Caio', phobia: 'claustrofobia' });
    data.slots[0] = first;
    data.slots[2] = second;
    data.activeSlot = 0;
    data.preferences.masterVolume = 0.2;
    data.preferences.voiceVolume = 0.5;

    expect(saves.save(data)).toBe(true);
    const restored = saves.load();
    expect(restored.version).toBe(3);
    expect(restored.slots[0]?.character.name).toBe('Ana');
    expect(restored.slots[0]?.character.gender).toBe('female');
    expect(restored.slots[0]?.game).toEqual(progress());
    expect(restored.slots[1]).toBeNull();
    expect(restored.slots[2]?.character.name).toBe('Caio');
    expect(restored.slots[2]?.game).toBeNull();
    expect(restored.activeSlot).toBe(0);
    expect(restored.preferences.voiceVolume).toBe(0.5);
  });

  it('migra um save antigo de campanha única para o primeiro registro', () => {
    const storage = new MemoryStorage();
    storage.setItem('limiar:save:v2', JSON.stringify({
      version: 2, updatedAt: '2026-10-01T00:00:00.000Z',
      preferences: { masterVolume: 0.5, musicVolume: 0.3, effectsVolume: 0.6, jumpscareIntensity: 0.4, showHealthBar: true },
      game: progress(),
    }));
    const restored = new SaveSystem(storage).load();
    expect(restored.version).toBe(3);
    expect(restored.slots[0]?.game).toEqual(progress());
    expect(restored.preferences.masterVolume).toBe(0.5);
    expect(restored.preferences.showHealthBar).toBe(true);
    // Sem o campo novo, a vocalização cai no padrão.
    expect(restored.preferences.voiceVolume).toBe(DEFAULT_PREFERENCES.voiceVolume);
    // A migração é gravada no formato novo.
    expect(storage.getItem('limiar:save:v3')).toContain('"version":3');
  });

  it('recupera dados corrompidos sem quebrar', () => {
    const storage = new MemoryStorage();
    storage.setItem('limiar:save:v3', '{inválido');
    expect(new SaveSystem(storage).load()).toEqual(DEFAULT_SAVE);
  });

  it('descarta o progresso quando a assinatura de integridade não bate', () => {
    const storage = new MemoryStorage();
    const saves = new SaveSystem(storage);
    const data = structuredClone(DEFAULT_SAVE);
    const slot = createSlot({ ...DEFAULT_CHARACTER, name: 'Ana' });
    slot.game = progress();
    data.slots[0] = slot;
    saves.save(data);

    const tampered = JSON.parse(storage.getItem('limiar:save:v3')!) as { slots: Array<{ game: GameSave } | null>; preferences: { masterVolume: number } };
    tampered.slots[0]!.game.stats.health = 100;
    storage.setItem('limiar:save:v3', JSON.stringify(tampered));

    const restored = new SaveSystem(storage).load();
    expect(restored.slots.every((entry) => entry === null)).toBe(true);
    expect(restored.activeSlot).toBeNull();
  });

  it('valida limites, personagens e itens com formato inválido', () => {
    const storage = new MemoryStorage();
    storage.setItem('limiar:save:v3', JSON.stringify({
      version: 99, updatedAt: 42, activeSlot: 9,
      preferences: { masterVolume: 8, musicVolume: -2, effectsVolume: 0.5, voiceVolume: 7, jumpscareIntensity: 3 },
      slots: [
        {
          character: { name: '  Ana <b>Maria</b>  ', gender: 'alien', classId: 'mago', phobia: 'inventada', startingItem: 'ração inválida' },
          game: {
            position: 'reception', stats: { health: 900, hunger: -5, thirst: 50, anxiety: -10 },
            inventory: [{ id: 'item com espaço', quantity: 4 }, { id: 'ration', quantity: 50 }, { id: 'customItem', quantity: 2 }],
            flags: { ok: true, bad: 'yes' }, discovered: ['reception', 'void'], moveCount: -4, elapsed: 20,
          },
        },
        'não é um registro',
      ],
    }));
    const restored = new SaveSystem(storage).load();
    expect(restored.version).toBe(3);
    expect(restored.slots).toHaveLength(SAVE_SLOT_COUNT);
    expect(restored.activeSlot).toBeNull();
    expect(restored.preferences.masterVolume).toBe(1);
    expect(restored.preferences.musicVolume).toBe(0);
    expect(restored.preferences.voiceVolume).toBe(1);
    const slot = restored.slots[0]!;
    expect(slot.character.name).toBe('Ana bMaria/b');
    expect(slot.character.gender).toBe(DEFAULT_CHARACTER.gender);
    expect(slot.character.classId).toBe(DEFAULT_CHARACTER.classId);
    expect(slot.character.phobia).toBe(DEFAULT_CHARACTER.phobia);
    expect(slot.character.startingItem).toBe(DEFAULT_CHARACTER.startingItem);
    expect(slot.game?.stats.health).toBe(100);
    expect(slot.game?.stats.hunger).toBe(0);
    expect(slot.game?.stats.anxiety).toBe(0);
    expect(slot.game?.inventory).toEqual([{ id: 'ration', quantity: 9 }, { id: 'customItem', quantity: 2 }]);
    expect(slot.game?.discovered).toEqual(['reception', 'void']);
    expect(restored.slots[1]).toBeNull();
  });

  it('apaga os registros locais', () => {
    const storage = new MemoryStorage();
    const saves = new SaveSystem(storage);
    saves.save(structuredClone(DEFAULT_SAVE));
    expect(saves.clear()).toBe(true);
    expect(storage.getItem('limiar:save:v3')).toBeNull();
  });
});

describe('fim de campanha', () => {
  it('o fim tira o progresso do registro e mantém o personagem', () => {
    const data = structuredClone(DEFAULT_SAVE);
    const slot = createSlot({ ...DEFAULT_CHARACTER, name: 'Ana' });
    slot.game = progress();
    data.slots[1] = slot;
    data.activeSlot = 1;

    expect(endCampaign(data, 1)).toBe(true);
    expect(data.slots[1]?.game).toBeNull();
    expect(data.slots[1]?.character.name).toBe('Ana');
    expect(data.activeSlot).toBeNull();
  });

  it('guarda como a campanha terminou e devolve isso depois de gravar', () => {
    const storage = new MemoryStorage();
    const saves = new SaveSystem(storage);
    const data = structuredClone(DEFAULT_SAVE);
    const slot = createSlot({ ...DEFAULT_CHARACTER, name: 'Ana' });
    slot.game = progress();
    data.slots[1] = slot;

    endCampaign(data, 1, { kind: 'death', room: 'Setor alagado', roomId: 'floodedRoom', elapsed: 763 });
    saves.save(data);

    const ending = saves.load().slots[1]?.ending;
    expect(ending).toEqual({ kind: 'death', room: 'Setor alagado', roomId: 'floodedRoom', elapsed: 763 });
  });

  it('descarta um fim inventado e mantém o registro legível', () => {
    const storage = new MemoryStorage();
    const saves = new SaveSystem(storage);
    const slot = createSlot({ ...DEFAULT_CHARACTER, name: 'Ana' });
    storage.setItem('limiar:save:v3', JSON.stringify({
      version: 3,
      slots: [{ ...slot, ending: { kind: 'desapareceu', room: 7, roomId: '../etc', elapsed: 'muito' } }],
    }));

    const restored = saves.load();
    expect(restored.slots[0]?.character.name).toBe('Ana');
    expect(restored.slots[0]?.ending).toBeUndefined();
  });

  it('o fim de uma fuga também fica gravado', () => {
    const data = structuredClone(DEFAULT_SAVE);
    const slot = createSlot({ ...DEFAULT_CHARACTER, name: 'Caio' });
    slot.game = progress();
    data.slots[0] = slot;

    endCampaign(data, 0, { kind: 'escape', room: 'O limiar', roomId: 'threshold', elapsed: 1200 });
    expect(data.slots[0]?.ending?.kind).toBe('escape');
    expect(data.slots[0]?.game).toBeNull();
  });

  it('o registro encerrado não volta a ser continuável depois de gravado', () => {
    const storage = new MemoryStorage();
    const saves = new SaveSystem(storage);
    const data = structuredClone(DEFAULT_SAVE);
    const slot = createSlot({ ...DEFAULT_CHARACTER, name: 'Caio' });
    // Morrer nunca é gravado: o save guarda o instante anterior à morte.
    slot.game = { ...progress(), stats: { health: 34, hunger: 0, thirst: 80, anxiety: 100 } };
    data.slots[0] = slot;
    data.activeSlot = 0;
    saves.save(data);
    expect(saves.load().slots[0]?.game).not.toBeNull();

    endCampaign(data, 0);
    saves.save(data);

    const restored = saves.load();
    expect(restored.slots[0]?.game).toBeNull();
    expect(restored.slots[0]?.character.name).toBe('Caio');
    expect(restored.activeSlot).toBeNull();
    expect(restored.slots.some((entry) => entry?.game)).toBe(false);
  });

  it('não mexe em um registro vazio', () => {
    const data = structuredClone(DEFAULT_SAVE);
    data.activeSlot = null;
    expect(endCampaign(data, 2)).toBe(false);
    expect(data.slots[2]).toBeNull();
  });
});
