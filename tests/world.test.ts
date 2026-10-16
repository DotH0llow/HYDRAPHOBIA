import { describe, expect, it } from 'vitest';
import { ROOMS } from '../src/config/world';
import type { RoomId } from '../src/types';

describe('mapa do mundo', () => {
  it('mantém todos os destinos válidos', () => {
    const ids = new Set(Object.keys(ROOMS));
    Object.values(ROOMS).forEach((room) => {
      Object.values(room.exits).forEach((exit) => expect(ids.has(exit.to)).toBe(true));
    });
  });

  it('permite alcançar a saída a partir da recepção', () => {
    const visited = new Set<RoomId>();
    const queue: RoomId[] = ['reception'];
    while (queue.length) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      Object.values(ROOMS[current].exits).forEach((exit) => queue.push(exit.to));
    }
    expect(visited.has('threshold')).toBe(true);
    expect(visited.size).toBe(Object.keys(ROOMS).length);
  });

  it('hotspots têm áreas válidas dentro da imagem', () => {
    Object.values(ROOMS).flatMap((room) => room.hotspots).forEach((hotspot) => {
      expect(hotspot.x).toBeGreaterThanOrEqual(0);
      expect(hotspot.y).toBeGreaterThanOrEqual(0);
      expect(hotspot.x + hotspot.width).toBeLessThanOrEqual(100);
      expect(hotspot.y + hotspot.height).toBeLessThanOrEqual(100);
    });
  });
});
