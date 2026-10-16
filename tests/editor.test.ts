import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { EditorProject } from '../src/editor/EditorProject';
import { levelToWorld } from '../src/editor/mapAdapter';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('editor visual de salas', () => {
  it('cria quatro salas, salva, carrega e executa o mapa na engine', () => {
    const storage = new MemoryStorage();
    const project = new EditorProject(storage);
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
});
