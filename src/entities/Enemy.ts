import type { EnemyDefinition } from '../config/enemyConfig';
import type { EventBus } from '../core/EventBus';
import type { RandomSource } from '../core/SeededRandom';
import type { EnemySnapshot, EnemyState, RoomId } from '../types';

export interface EnemyWorld {
  gateClosed(side: 'west' | 'east'): boolean;
}

const VALID_TRANSITIONS: Record<EnemyState, EnemyState[]> = {
  DORMANT: ['PATROLLING'],
  PATROLLING: ['APPROACHING', 'AT_GATE'],
  APPROACHING: ['PATROLLING', 'AT_GATE'],
  AT_GATE: ['ATTACKING', 'RETREATING', 'STUNNED'],
  ATTACKING: ['RETREATING', 'STUNNED'],
  RETREATING: ['COOLDOWN'],
  COOLDOWN: ['PATROLLING'],
  STUNNED: ['RETREATING'],
};

export class Enemy {
  state: EnemyState;
  routeIndex = 0;
  private stateTime = 0;
  private moveTime = 0;
  private hiddenFor = 0;
  private attractionFor = 0;

  constructor(
    readonly config: EnemyDefinition,
    readonly aggression: number,
    private readonly random: RandomSource,
    private readonly events: EventBus,
  ) {
    this.state = aggression > 0 ? 'DORMANT' : 'COOLDOWN';
  }

  get active(): boolean { return this.aggression > 0; }
  get room(): RoomId { return this.config.route[this.routeIndex] ?? this.config.route[0]!; }
  get isVisible(): boolean { return this.active && this.config.id !== 'veiledWidow' ? true : this.hiddenFor <= 0; }

  update(delta: number, world: EnemyWorld): void {
    if (!this.active || delta <= 0) return;
    this.stateTime += delta;
    this.moveTime += delta;
    this.hiddenFor = Math.max(0, this.hiddenFor - delta);
    this.attractionFor = Math.max(0, this.attractionFor - delta);

    switch (this.state) {
      case 'DORMANT':
        if (this.stateTime >= Math.max(8, 25 - this.aggression * 2)) this.transition('PATROLLING');
        break;
      case 'PATROLLING':
      case 'APPROACHING':
        this.considerMove();
        break;
      case 'AT_GATE':
        this.resolveGate(world);
        break;
      case 'ATTACKING':
        if (this.config.side && world.gateClosed(this.config.side)) this.transition('RETREATING');
        else if (this.stateTime >= this.config.attackDelay) this.events.emit('enemy:attack', { id: this.config.id });
        break;
      case 'RETREATING':
        if (this.stateTime >= 0.7) {
          this.stateTime = 0;
          if (this.routeIndex > 0) { this.routeIndex -= 1; this.emitMove('recuo'); }
          else this.transition('COOLDOWN');
        }
        break;
      case 'COOLDOWN':
        if (this.stateTime >= this.config.cooldown) this.transition('PATROLLING');
        break;
      case 'STUNNED':
        if (this.stateTime >= 0) this.transition('RETREATING');
        break;
    }
  }

  stun(seconds: number): boolean {
    if (!this.active || this.config.id !== 'blindMonk' || !['AT_GATE', 'ATTACKING'].includes(this.state)) return false;
    this.transition('STUNNED');
    this.stateTime = -Math.max(0, seconds);
    return true;
  }

  attract(seconds: number): void {
    if (!this.active || this.config.id === 'blindMonk') return;
    this.attractionFor = Math.max(this.attractionFor, seconds);
    this.moveTime += this.moveInterval * 0.38;
  }

  force(state: EnemyState, room?: RoomId): void {
    if (room) {
      const index = this.config.route.indexOf(room);
      if (index >= 0) this.routeIndex = index;
    }
    this.state = state;
    this.stateTime = 0;
    this.moveTime = 0;
  }

  canTransition(next: EnemyState): boolean { return VALID_TRANSITIONS[this.state].includes(next); }

  snapshot(): EnemySnapshot {
    return {
      id: this.config.id,
      name: this.config.name,
      state: this.state,
      room: this.room,
      visible: this.isVisible,
      threat: Math.min(1, this.routeIndex / Math.max(1, this.config.route.length - 1)),
    };
  }

  private get moveInterval(): number {
    const pressure = 1 + this.aggression * 0.075 + (this.attractionFor > 0 ? 0.36 : 0);
    return Math.max(3.5, this.config.baseMoveInterval / pressure);
  }

  private considerMove(): void {
    if (this.moveTime < this.moveInterval) return;
    this.moveTime = 0;
    const chance = Math.min(0.9, this.config.moveChance + this.aggression * 0.035 + (this.attractionFor > 0 ? 0.16 : 0));
    if (this.random.next() > chance) return;

    const lastIndex = this.config.route.length - 1;
    if (this.routeIndex < lastIndex) {
      this.routeIndex += 1;
      if (this.config.id === 'veiledWidow' && this.random.next() < 0.38) this.hiddenFor = 4 + this.random.next() * 5;
      const atDestination = this.routeIndex === lastIndex;
      const nearDestination = this.routeIndex === lastIndex - 1;
      this.transition(atDestination ? 'AT_GATE' : nearDestination ? 'APPROACHING' : 'PATROLLING');
      this.emitMove(this.cueForRoom());
      if (nearDestination || atDestination) {
        this.events.emit('enemy:danger', { id: this.config.id, message: this.dangerMessage(atDestination) });
      }
    }
  }

  private resolveGate(world: EnemyWorld): void {
    if (this.config.id === 'blindMonk') {
      if (this.stateTime >= this.config.attackDelay) this.transition('ATTACKING');
      return;
    }
    if (this.config.side && world.gateClosed(this.config.side)) {
      if (this.stateTime >= this.config.gateWait) this.transition('RETREATING');
    } else if (this.stateTime >= this.config.gateWait) {
      this.transition('ATTACKING');
    }
  }

  private transition(next: EnemyState): void {
    if (next !== this.state && !this.canTransition(next)) return;
    this.state = next;
    this.stateTime = 0;
    this.moveTime = 0;
    if (next === 'RETREATING') this.events.emit('enemy:danger', { id: this.config.id, message: `${this.config.name} recua para as sombras.` });
  }

  private cueForRoom(): string {
    if (this.config.id === 'hollowKnight') return 'metal';
    if (this.config.id === 'veiledWidow') return 'whisper';
    return 'chant';
  }

  private dangerMessage(atDestination: boolean): string {
    if (this.config.id === 'blindMonk') return atDestination ? 'O cântico cessou dentro da torre. Toque o sino!' : 'Um cântico grave atravessa as paredes.';
    const side = this.config.side === 'west' ? 'oeste' : 'leste';
    return atDestination ? `${this.config.name} alcançou o portão ${side}.` : `Há movimento no corredor ${side}.`;
  }

  private emitMove(cue: string): void {
    this.events.emit('enemy:moved', { id: this.config.id, room: this.room, cue });
  }
}

export { VALID_TRANSITIONS };
