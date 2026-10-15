import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../src/config/gameConfig';
import { EnergySystem } from '../src/systems/EnergySystem';

describe('EnergySystem', () => {
  it('consome energia proporcional ao tempo', () => {
    const energy = new EnergySystem();
    energy.update(10, { closedGates: 0, mirror: false, light: false });
    expect(energy.value).toBeCloseTo(100 - GAME_CONFIG.energy.passiveDrain * 10);
  });

  it('soma o consumo de defesas simultâneas', () => {
    const energy = new EnergySystem();
    energy.update(10, { closedGates: 2, mirror: true, light: true });
    const expectedRate = 0.13 + 2 * 0.22 + 0.1 + 0.18;
    expect(energy.value).toBeCloseTo(100 - expectedRate * 10);
  });

  it('respeita mínimo e máximo e sinaliza esgotamento uma vez', () => {
    const energy = new EnergySystem();
    energy.set(200);
    expect(energy.value).toBe(100);
    energy.set(0.01);
    expect(energy.update(10, { closedGates: 0, mirror: false, light: false })).toBe(true);
    expect(energy.value).toBe(0);
    expect(energy.update(10, { closedGates: 0, mirror: false, light: false })).toBe(false);
  });
});
