import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../src/config/gameConfig';
import { Gate } from '../src/systems/GateSystem';

describe('Gate', () => {
  it('passa por estados intermediários sem alternar durante a animação', () => {
    const gate = new Gate('west');
    expect(gate.toggle(true)).toBe(true);
    expect(gate.state).toBe('CLOSING');
    expect(gate.toggle(true)).toBe(false);
    gate.update(GAME_CONFIG.gate.transitionSeconds / 2);
    expect(gate.progress).toBeCloseTo(0.5);
    gate.update(GAME_CONFIG.gate.transitionSeconds / 2);
    expect(gate.state).toBe('CLOSED');
    expect(gate.blocksAttack()).toBe(true);
  });

  it('falha sem energia e fica indisponível quando desativado', () => {
    const gate = new Gate('east');
    expect(gate.toggle(false)).toBe(false);
    gate.disable();
    expect(gate.state).toBe('UNAVAILABLE');
    expect(gate.blocksAttack()).toBe(false);
  });
});
