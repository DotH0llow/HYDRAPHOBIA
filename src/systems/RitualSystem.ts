import { GAME_CONFIG } from '../config/gameConfig';
import type { EnemySystem } from './EnemySystem';

export class RitualSystem {
  cooldownRemaining = 0;
  update(delta: number): void { this.cooldownRemaining = Math.max(0, this.cooldownRemaining - Math.max(0, delta)); }
  get ready(): boolean { return this.cooldownRemaining === 0; }

  ringBell(enemies: EnemySystem): boolean | null {
    if (!this.ready) return null;
    this.cooldownRemaining = GAME_CONFIG.bell.cooldownSeconds;
    const effective = enemies.enemies.blindMonk.stun(GAME_CONFIG.bell.stunSeconds);
    enemies.enemies.hollowKnight.attract(GAME_CONFIG.bell.attractionSeconds);
    enemies.enemies.veiledWidow.attract(GAME_CONFIG.bell.attractionSeconds);
    return effective;
  }
}
