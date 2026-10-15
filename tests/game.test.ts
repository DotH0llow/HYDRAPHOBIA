import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import type { RandomSource } from '../src/core/SeededRandom';

class FixedRandom implements RandomSource { next(): number { return 0; } }
class StillRandom implements RandomSource { next(): number { return 1; } }

describe('partida completa', () => {
  it('vence uma única vez às 06:00', () => {
    const game = new Game(1, new FixedRandom());
    let victories = 0;
    game.events.on('game:victory', () => { victories += 1; });
    game.start();
    game.debugAdvance(game.time.duration - 0.1);
    game.update(0.1);
    game.update(10);
    expect(game.status).toBe('victory');
    expect(victories).toBe(1);
  });

  it('energia zero desabilita todas as defesas', () => {
    const game = new Game(1, new FixedRandom());
    game.start();
    game.debugSetEnergy(0.001);
    game.toggleMirror();
    game.update(1);
    expect(game.energy.value).toBe(0);
    expect(game.mirrorOpen).toBe(false);
    expect(game.gates.gates.west.state).toBe('UNAVAILABLE');
  });

  it.each([1, 2, 3])('permite concluir a noite %s', (night) => {
    const game = new Game(night, new StillRandom());
    game.start();
    for (let second = 0; second < game.time.duration; second += 1) game.update(1);
    expect(game.status).toBe('victory');
    expect(game.energy.value).toBeGreaterThan(0);
  });
});
