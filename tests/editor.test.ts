import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { EditorProject } from '../src/editor/EditorProject';
import { levelToWorld } from '../src/editor/mapAdapter';
import { createLight } from '../src/editor/types';
import { flickerFactor, hasFlicker, isLightShape, LIGHT_SHAPES } from '../src/systems/lighting';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('editor visual de salas', () => {
  it('cria quatro salas, salva, carrega e executa o mapa na engine', () => {
    const storage = new MemoryStorage();
    const project = new EditorProject(storage);
    project.addLevel('Teste de quatro salas');
    const first = project.activeLevel.rooms[0]!;
    const second = project.addRoom();
    const third = project.addRoom();
    const fourth = project.addRoom();
    [first, second, third, fourth].forEach((room, index) => { room.image = `/assets/scenes/${index % 2 ? 'corridor' : 'reception'}.jpg`; });
    const connection = project.addConnection(first.id, second.id)!;
    connection.bidirectional = true;
    project.addConnection(second.id, third.id);
    project.addConnection(third.id, fourth.id);
    const hotspot = project.addHotspot(first.id)!;
    hotspot.action = 'collect';
    hotspot.item = 'almondWater';
    hotspot.message = 'Uma garrafa foi coletada.';
    project.save();

    const restored = new EditorProject(storage);
    expect(restored.activeLevel.rooms).toHaveLength(4);
    expect(restored.activeLevel.connections).toHaveLength(3);
    const game = new Game(undefined, () => 1, levelToWorld(restored.activeLevel));
    expect(game.interact(hotspot.id).pickup).toBe('almondWater');
    expect(game.navigate(connection.direction).changed).toBe(true);
    expect(game.position).toBe(second.id);
  });

  it('duplica hotspots com IDs próprios e remove conexões de salas excluídas', () => {
    const project = new EditorProject(null);
    project.addLevel('Duplicação');
    const source = project.activeLevel.rooms[0]!;
    const target = project.addRoom();
    const hotspot = project.addHotspot(source.id)!;
    const copy = project.duplicateRoom(source.id)!;
    expect(copy.id).not.toBe(source.id);
    expect(copy.hotspots[0]?.id).not.toBe(hotspot.id);
    project.addConnection(copy.id, target.id);
    expect(project.deleteRoom(copy.id)).toBe(true);
    expect(project.activeLevel.connections).toHaveLength(0);
  });

  it('aplica requisito de item e eventos configurados no editor', () => {
    const project = new EditorProject(null);
    project.addLevel('Requisitos');
    const source = project.activeLevel.rooms[0]!;
    const destination = project.addRoom();
    const connection = project.addConnection(source.id, destination.id)!;
    connection.requiresItem = 'accessCard';
    const card = project.addHotspot(source.id)!;
    card.action = 'collect';
    card.item = 'accessCard';
    const threat = project.addHotspot(destination.id)!;
    threat.action = 'event';
    threat.event = 'watcher';
    const game = new Game(undefined, () => 1, levelToWorld(project.activeLevel));
    expect(game.navigate(connection.direction).changed).toBe(false);
    game.interact(card.id);
    expect(game.navigate(connection.direction).changed).toBe(true);
    game.interact(threat.id);
    expect(game.encounter?.id).toBe('watcher');
  });

  it('inicia com todas as salas e conexões do jogo configuradas', () => {
    const project = new EditorProject(null);
    expect(project.activeLevel.rooms.map((room) => room.id)).toContain('threshold');
    expect(project.activeLevel.rooms).toHaveLength(7);
    expect(project.activeLevel.connections.length).toBeGreaterThanOrEqual(10);
    expect(project.activeLevel.escapeRoomId).toBe('threshold');
    const world = levelToWorld(project.activeLevel);
    expect(world.rooms.mainCorridor.exits.forward.requires).toBe('maintenanceUnlocked');
  });
});

describe('iluminação das salas', () => {
  it('preserva escuridão e focos de luz entre recarregamentos', () => {
    const storage = new MemoryStorage();
    const project = new EditorProject(storage);
    const room = project.activeLevel.rooms[0]!;
    room.darknessLevel = 0.75;
    room.lights = [createLight('luz-teste')];
    room.lights[0]!.shape = 'star';
    room.lights[0]!.angle = 45;
    room.lights[0]!.flicker = 0.4;
    room.lights[0]!.radius = 33;
    project.save();

    const restored = new EditorProject(storage).findRoom(room.id)!;
    expect(restored.darknessLevel).toBe(0.75);
    expect(restored.lights).toHaveLength(1);
    expect(restored.lights![0]).toMatchObject({ shape: 'star', angle: 45, flicker: 0.4, radius: 33 });

    // E chega inteira na engine.
    const world = levelToWorld(new EditorProject(storage).activeLevel);
    expect(world.rooms[room.id]!.lights![0]).toMatchObject({ shape: 'star', angle: 45, flicker: 0.4 });
  });

  it('corrige valores de luz fora da faixa e formatos inexistentes', () => {
    const storage = new MemoryStorage();
    const project = new EditorProject(storage);
    const room = project.activeLevel.rooms[0]!;
    room.lights = [{ id: 'luz-ruim', x: 500, y: -20, radius: 999, intensity: 5, color: 'azul', angle: 400, shape: 'hexágono' as never, flicker: 9 }];
    project.save();

    const light = new EditorProject(storage).findRoom(room.id)!.lights![0]!;
    expect(light).toMatchObject({ x: 100, y: 0, radius: 60, intensity: 1, color: '#fffbe8', angle: 40, shape: 'circle', flicker: 1 });
  });

  it('leva a rotação da seta de "Mudar de sala" até a engine', () => {
    const project = new EditorProject(null);
    const room = project.activeLevel.rooms[0]!;
    const hotspot = project.addHotspot(room.id)!;
    hotspot.action = 'move';
    hotspot.arrowRotation = 270;
    const runtime = levelToWorld(project.activeLevel).rooms[room.id]!.hotspots.find((entry) => entry.id === hotspot.id)!;
    expect(runtime.kind).toBe('move');
    expect(runtime.arrowRotation).toBe(270);
  });
});

describe('focos de luz desenhados', () => {
  it('mantém o brilho estável sem flickering e oscila com ele', () => {
    const steady = { x: 50, y: 50, radius: 20, intensity: 1, flicker: 0 };
    expect(flickerFactor(steady, 0)).toBe(1);
    expect(flickerFactor(steady, 1234)).toBe(1);
    expect(hasFlicker([steady])).toBe(false);

    const blinking = { ...steady, flicker: 0.6 };
    expect(hasFlicker([blinking])).toBe(true);
    const samples = Array.from({ length: 200 }, (_, index) => flickerFactor(blinking, index * 37));
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0.4);
    expect(Math.max(...samples)).toBeLessThanOrEqual(1);
    // Realmente varia ao longo do tempo.
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.2);
  });

  it('oferece os seis formatos pedidos para os focos', () => {
    expect(LIGHT_SHAPES.map((shape) => shape.id)).toEqual(['circle', 'square', 'rectangle', 'star', 'pentagon', 'triangle']);
    expect(isLightShape('star')).toBe(true);
    expect(isLightShape('hexágono')).toBe(false);
  });
});
