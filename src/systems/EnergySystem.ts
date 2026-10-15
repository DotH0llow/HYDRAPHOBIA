import { GAME_CONFIG } from '../config/gameConfig';

export interface EnergyUsage { closedGates: number; mirror: boolean; light: boolean }

export class EnergySystem {
  readonly maximum: number = GAME_CONFIG.energy.maximum;
  value: number = this.maximum;
  depleted = false;

  update(delta: number, usage: EnergyUsage): boolean {
    if (this.depleted || delta <= 0) return false;
    const rate = GAME_CONFIG.energy.passiveDrain
      + usage.closedGates * GAME_CONFIG.energy.closedGateDrain
      + (usage.mirror ? GAME_CONFIG.energy.mirrorDrain : 0)
      + (usage.light ? GAME_CONFIG.energy.lightDrain : 0);
    const previous = this.value;
    this.value = this.clamp(this.value - rate * delta);
    if (previous > 0 && this.value === 0) { this.depleted = true; return true; }
    return false;
  }

  set(value: number): void {
    this.value = this.clamp(value);
    this.depleted = this.value === 0;
  }

  private clamp(value: number): number { return Math.max(0, Math.min(this.maximum, value)); }
}
