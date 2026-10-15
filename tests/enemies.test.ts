import { describe, expect, it } from 'vitest';
import { ENEMY_CONFIG } from '../src/config/enemyConfig';
import { EventBus } from '../src/core/EventBus';
import type { RandomSource } from '../src/core/SeededRandom';
import { Enemy } from '../src/entities/Enemy';

class FixedRandom implements RandomSource { constructor(private readonly value: number) {} next(): number { return this.value; } }

describe('Enemy FSM', () => {
  it('obedece a transições válidas e à rota configurada', () => {
    const enemy = new Enemy(ENEMY_CONFIG.hollowKnight, 6, new FixedRandom(0), new EventBus());
    enemy.force('PATROLLING');
    for (let i = 0; i < 4; i += 1) enemy.update(20, { gateClosed: () => false });
    expect(ENEMY_CONFIG.hollowKnight.route).toContain(enemy.room);
    expect(['APPROACHING', 'AT_GATE', 'ATTACKING']).toContain(enemy.state);
    expect(enemy.canTransition('DORMANT')).toBe(false);
  });

  it('recua diante de um portão fechado', () => {
    const enemy = new Enemy(ENEMY_CONFIG.hollowKnight, 6, new FixedRandom(0), new EventBus());
    enemy.force('AT_GATE', 'westGate');
    enemy.update(ENEMY_CONFIG.hollowKnight.gateWait + 0.1, { gateClosed: () => true });
    expect(enemy.state).toBe('RETREATING');
  });

  it('ataca quando o portão permanece aberto', () => {
    const events = new EventBus();
    let attacked = false;
    events.on('enemy:attack', () => { attacked = true; });
    const enemy = new Enemy(ENEMY_CONFIG.veiledWidow, 5, new FixedRandom(0), events);
    enemy.force('AT_GATE', 'eastGate');
    enemy.update(ENEMY_CONFIG.veiledWidow.gateWait + 0.1, { gateClosed: () => false });
    expect(enemy.state).toBe('ATTACKING');
    enemy.update(ENEMY_CONFIG.veiledWidow.attackDelay + 0.1, { gateClosed: () => false });
    expect(attacked).toBe(true);
  });

  it('sino atordoa apenas o Monge na janela correta e leva ao recuo', () => {
    const monk = new Enemy(ENEMY_CONFIG.blindMonk, 4, new FixedRandom(0), new EventBus());
    monk.force('AT_GATE', 'tower');
    expect(monk.stun(3)).toBe(true);
    expect(monk.state).toBe('STUNNED');
    monk.update(3.1, { gateClosed: () => false });
    expect(monk.state).toBe('RETREATING');
  });
});
