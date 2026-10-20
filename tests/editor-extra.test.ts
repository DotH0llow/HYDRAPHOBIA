import { describe, expect, it } from 'vitest';
import { EditorProject } from '../src/editor/EditorProject';
import { projectToWorld } from '../src/editor/mapAdapter';
import { createLight, ROOM_AUDIO_MODES } from '../src/editor/types';
import { apertureOf, shapeReach } from '../src/systems/lighting';
import { labelAnchorOf } from '../src/systems/hotspots';
import { PHOBIAS } from '../src/config/character';
import { HUNGER_LOW_THRESHOLD, HUNGER_THRESHOLD, THIRST_LOW_THRESHOLD, THIRST_THRESHOLD } from '../src/config/thresholds';
import { categoryLabel, clipFileName, FX_HUNGER_LOW, MUSIC_LOBBY } from '../src/systems/audioLibrary';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('focos de luz por abertura', () => {
  it('trata a abertura ausente como foco inteiro e limita o intervalo', () => {
    expect(apertureOf({ x: 0, y: 0, radius: 10, intensity: 1 })).toBe(360);
    expect(apertureOf({ x: 0, y: 0, radius: 10, intensity: 1, aperture: 180 })).toBe(180);
    expect(apertureOf({ x: 0, y: 0, radius: 10, intensity: 1, aperture: 9000 })).toBe(360);
    expect(apertureOf({ x: 0, y: 0, radius: 10, intensity: 1, aperture: -4 })).toBe(1);
  });

  it('estende o degradê até o vértice mais distante de cada formato', () => {
    // Com alcance 1 o quadrado só acendia o círculo inscrito e parecia um círculo.
    expect(shapeReach('circle')).toBe(1);
    expect(shapeReach('square')).toBeCloseTo(Math.SQRT2, 5);
    expect(shapeReach('rectangle')).toBeGreaterThan(1);
    expect(shapeReach('triangle')).toBeCloseTo(1, 5);
  });

  it('guarda a abertura do foco entre recarregamentos', () => {
    const storage = new MemoryStorage();
    const project = new EditorProject(storage);
    const room = project.activeLevel.rooms[0]!;
    room.lights = [{ ...createLight('luz-teste'), aperture: 180 }];
    project.save();
    expect(new EditorProject(storage).findRoom(room.id)!.lights![0]!.aperture).toBe(180);
  });
});

describe('níveis', () => {
  it('cria um nível vazio, sem as salas do anterior, e renomeia', () => {
    const project = new EditorProject(null);
    const before = project.activeLevel.rooms.map((room) => room.id);
    const level = project.addLevel();
    expect(level.rooms).toHaveLength(1);
    expect(level.connections).toHaveLength(0);
    expect(before).not.toContain(level.rooms[0]!.id);
    expect(project.activeLevel.id).toBe(level.id);

    expect(project.renameLevel(level.id, 'Subsolo')).toBe(true);
    expect(project.findLevel(level.id)!.name).toBe('Subsolo');
    expect(project.renameLevel(level.id, '   ')).toBe(false);
  });

  it('nunca repete o nome de um nível criado sem nome escolhido', () => {
    const project = new EditorProject(null);
    const first = project.addLevel('Nível novo');
    const second = project.addLevel('Nível novo');
    expect(second.name).not.toBe(first.name);
  });

  it('exclui um nível e limpa os caminhos que apontavam para ele', () => {
    const project = new EditorProject(null);
    const target = project.addLevel('Alvo');
    const targetRoom = target.rooms[0]!;
    const origin = project.data.levels[0]!;
    project.setActiveLevel(origin.id);
    const hotspot = project.addHotspot(origin.rooms[0]!.id)!;
    hotspot.action = 'move';
    hotspot.targetLevelId = target.id;
    hotspot.targetRoomId = targetRoom.id;

    expect(project.deleteLevel(target.id)).toBe(true);
    expect(hotspot.targetRoomId).toBeUndefined();
    expect(hotspot.targetLevelId).toBeUndefined();
  });

  it('não deixa o projeto ficar sem nenhum nível', () => {
    const project = new EditorProject(null);
    while (project.data.levels.length > 1) project.deleteLevel(project.data.levels[1]!.id);
    expect(project.deleteLevel(project.data.levels[0]!.id)).toBe(false);
  });
});

describe('caminhos entre níveis', () => {
  it('junta as salas de todos os níveis em um mundo só', () => {
    const project = new EditorProject(null);
    const origin = project.data.levels[0]!;
    const other = project.addLevel('Nível de destino');
    project.setActiveLevel(origin.id);

    const world = projectToWorld(project.data.levels, origin.id);
    expect(world.rooms[other.rooms[0]!.id]).toBeDefined();
    expect(world.startRoomId).toBe(origin.startRoomId);
    expect(world.roomLevelName[other.rooms[0]!.id]).toBe('Nível de destino');
  });

  it('mantém uma conexão que atravessa para outro nível ao recarregar', () => {
    const storage = new MemoryStorage();
    const project = new EditorProject(storage);
    const origin = project.data.levels[0]!;
    const other = project.addLevel('Porão');
    project.setActiveLevel(origin.id);
    const connection = project.addConnection(origin.rooms[0]!.id, origin.rooms[1]!.id)!;
    connection.toLevelId = other.id;
    connection.to = other.rooms[0]!.id;
    project.save();

    const reloaded = new EditorProject(storage);
    const saved = reloaded.data.levels.find((level) => level.id === origin.id)!.connections.find((entry) => entry.id === connection.id)!;
    expect(saved.toLevelId).toBe(other.id);
    expect(saved.to).toBe(other.rooms[0]!.id);
  });
});

describe('trilha presa a uma sala', () => {
  it('oferece as três formas de repetição pedidas', () => {
    expect(ROOM_AUDIO_MODES.map((mode) => mode.id)).toEqual(['once', 'loop', 'every-entry']);
  });

  it('guarda arquivo, modo e volume e descarta configuração sem arquivo', () => {
    const storage = new MemoryStorage();
    const project = new EditorProject(storage);
    const room = project.activeLevel.rooms[0]!;
    room.audio = { path: '/assets/audio/Music/Menu/tema.ogg', mode: 'loop', volume: 0.5 };
    project.save();
    expect(new EditorProject(storage).findRoom(room.id)!.audio).toEqual({ path: '/assets/audio/Music/Menu/tema.ogg', mode: 'loop', volume: 0.5 });

    room.audio = { path: '   ', mode: 'once', volume: 1 };
    project.save();
    expect(new EditorProject(storage).findRoom(room.id)!.audio).toBeUndefined();
  });

  it('leva a trilha da sala até a engine', () => {
    const project = new EditorProject(null);
    const room = project.activeLevel.rooms[0]!;
    room.audio = { path: '/assets/audio/FX/porta.ogg', mode: 'every-entry', volume: 1 };
    const world = projectToWorld(project.data.levels, project.data.activeLevelId);
    expect(world.rooms[room.id]!.audio).toMatchObject({ path: '/assets/audio/FX/porta.ogg', mode: 'every-entry' });
  });
});

describe('interagíveis', () => {
  it('aceita áreas maiores que a cena', () => {
    const storage = new MemoryStorage();
    const project = new EditorProject(storage);
    const room = project.activeLevel.rooms[0]!;
    const hotspot = project.addHotspot(room.id)!;
    hotspot.x = 10;
    hotspot.width = 220;
    hotspot.height = 180;
    hotspot.shapePoints = [{ x: -120, y: -60 }, { x: 260, y: -60 }, { x: 260, y: 240 }];
    project.save();

    const saved = new EditorProject(storage).findRoom(room.id)!.hotspots.find((entry) => entry.id === hotspot.id)!;
    expect(saved.width).toBe(220);
    expect(saved.height).toBe(180);
    expect(saved.shapePoints![0]).toEqual({ x: -120, y: -60 });
  });

  it('ancora a etiqueta acima da vértice mais próxima do círculo visível', () => {
    const anchor = labelAnchorOf({
      indicator: { x: 70, y: 60 },
      shape: { points: [{ x: 10, y: 12 }, { x: 80, y: 10 }, { x: 90, y: 90 }, { x: 5, y: 85 }] },
    });
    // Entre as duas vértices do topo, vence a mais perto do círculo (x 80).
    expect(anchor.x).toBe(80);
    expect(anchor.y).toBe(10);
  });

  it('sem contorno próprio a etiqueta fica no topo da área', () => {
    expect(labelAnchorOf({ indicator: { x: 42, y: 70 } })).toEqual({ x: 42, y: 0 });
  });
});

describe('personagem e áudio', () => {
  it('oferece as doze fobias da criação de personagem', () => {
    expect(PHOBIAS.map((phobia) => phobia.id)).toEqual([
      'nictofobia', 'claustrofobia', 'hemofobia', 'monofobia',
      'talassofobia', 'escopofobia', 'automatonofobia', 'necrofobia',
      'fonofobia', 'mecanofobia', 'tanatofobia', 'apeirofobia',
    ]);
    expect(new Set(PHOBIAS.map((phobia) => phobia.label)).size).toBe(PHOBIAS.length);
  });

  it('reclama de fome e sede só abaixo de 40, e em estado crítico abaixo de 15', () => {
    expect(HUNGER_THRESHOLD).toBe(40);
    expect(THIRST_THRESHOLD).toBe(40);
    expect(HUNGER_LOW_THRESHOLD).toBe(15);
    expect(THIRST_LOW_THRESHOLD).toBe(15);
  });

  it('dá um nome único e legível a cada categoria de som', () => {
    expect(categoryLabel(FX_HUNGER_LOW)).toBe('VOZ · Fome crítica');
    expect(categoryLabel(MUSIC_LOBBY)).toBe('TRILHA · Lobby (nível 0)');
    expect(categoryLabel('fx:inexistente')).toBe('fx:inexistente');
    expect(clipFileName('/assets/audio/FX/Hunger/hunger_low_01.ogg')).toBe('hunger_low_01.ogg');
  });
});
