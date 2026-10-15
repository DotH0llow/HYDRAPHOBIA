import { GAME_CONFIG } from '../config/gameConfig';
import type { GateSnapshot, GateState, Side } from '../types';

export class Gate {
  state: GateState = 'OPEN';
  progress = 0;
  constructor(public readonly side: Side) {}

  toggle(hasEnergy: boolean): boolean {
    if (!hasEnergy || this.state === 'UNAVAILABLE' || this.state === 'CLOSING' || this.state === 'OPENING') return false;
    this.state = this.state === 'OPEN' ? 'CLOSING' : 'OPENING';
    return true;
  }

  update(delta: number): boolean {
    const step = Math.max(0, delta) / GAME_CONFIG.gate.transitionSeconds;
    if (this.state === 'CLOSING') {
      this.progress = Math.min(1, this.progress + step);
      if (this.progress === 1) { this.state = 'CLOSED'; return true; }
    } else if (this.state === 'OPENING') {
      this.progress = Math.max(0, this.progress - step);
      if (this.progress === 0) { this.state = 'OPEN'; return true; }
    }
    return false;
  }

  disable(): void { this.state = 'UNAVAILABLE'; this.progress = 0; }
  blocksAttack(): boolean { return this.state === 'CLOSED'; }
  snapshot(): GateSnapshot { return { side: this.side, state: this.state, progress: this.progress }; }
}

export class GateSystem {
  readonly gates = { west: new Gate('west'), east: new Gate('east') };
  update(delta: number): void { this.gates.west.update(delta); this.gates.east.update(delta); }
  toggle(side: Side, hasEnergy: boolean): boolean { return this.gates[side].toggle(hasEnergy); }
  disableAll(): void { this.gates.west.disable(); this.gates.east.disable(); }
  closedCount(): number { return Number(this.gates.west.state === 'CLOSED') + Number(this.gates.east.state === 'CLOSED'); }
}
