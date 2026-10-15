import { describe, expect, it } from 'vitest';
import { TimeSystem } from '../src/systems/TimeSystem';

describe('TimeSystem', () => {
  it('é independente da divisão de frames', () => {
    const single = new TimeSystem(360);
    const sliced = new TimeSystem(360);
    single.update(60);
    for (let i = 0; i < 600; i += 1) sliced.update(0.1);
    expect(sliced.elapsed).toBeCloseTo(single.elapsed, 5);
    expect(sliced.hour).toBe('01:00');
  });

  it('pausa e dispara vitória apenas ao alcançar a duração', () => {
    const time = new TimeSystem(10);
    time.paused = true;
    expect(time.update(20)).toBe(false);
    expect(time.elapsed).toBe(0);
    time.paused = false;
    expect(time.update(10)).toBe(true);
    expect(time.update(1)).toBe(false);
    expect(time.hour).toBe('06:00');
  });
});
