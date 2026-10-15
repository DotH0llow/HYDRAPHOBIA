export interface RandomSource { next(): number }

export class SeededRandom implements RandomSource {
  private state: number;
  constructor(seed = Date.now()) { this.state = seed >>> 0 || 1; }
  next(): number {
    let value = this.state += 0x6d2b79f5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  }
}
