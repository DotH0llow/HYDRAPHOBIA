import { ENEMY_CONFIG } from '../config/enemyConfig';
import type { EventBus } from '../core/EventBus';
import { SeededRandom, type RandomSource } from '../core/SeededRandom';
import { Enemy, type EnemyWorld } from '../entities/Enemy';
import type { EnemyId } from '../types';

export class EnemySystem {
  readonly enemies: Record<EnemyId, Enemy>;

  constructor(levels: Record<EnemyId, number>, events: EventBus, random: RandomSource = new SeededRandom()) {
    this.enemies = {
      hollowKnight: new Enemy(ENEMY_CONFIG.hollowKnight, levels.hollowKnight, random, events),
      veiledWidow: new Enemy(ENEMY_CONFIG.veiledWidow, levels.veiledWidow, random, events),
      blindMonk: new Enemy(ENEMY_CONFIG.blindMonk, levels.blindMonk, random, events),
    };
  }

  update(delta: number, world: EnemyWorld): void {
    Object.values(this.enemies).forEach((enemy) => enemy.update(delta, world));
  }

  active(): Enemy[] { return Object.values(this.enemies).filter((enemy) => enemy.active); }
}
