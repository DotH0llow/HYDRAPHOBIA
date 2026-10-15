export class TimeSystem {
  elapsed = 0;
  paused = false;
  private finished = false;

  constructor(public readonly duration: number) {}

  update(delta: number): boolean {
    if (this.paused || this.finished) return false;
    this.elapsed = Math.min(this.duration, this.elapsed + Math.max(0, delta));
    if (this.elapsed >= this.duration) { this.finished = true; return true; }
    return false;
  }

  get progress(): number { return this.duration === 0 ? 1 : this.elapsed / this.duration; }
  get hour(): string {
    const hour = Math.min(6, Math.floor(this.progress * 6));
    return `${hour.toString().padStart(2, '0')}:00`;
  }

  setElapsed(seconds: number): void {
    this.elapsed = Math.max(0, Math.min(this.duration, seconds));
    this.finished = this.elapsed >= this.duration;
  }
}
