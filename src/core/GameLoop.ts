import { GAME_CONFIG } from '../config/gameConfig';

export class GameLoop {
  private frameId = 0;
  private previous = 0;
  private accumulator = 0;
  private running = false;
  private speed = 1;

  constructor(private readonly update: (delta: number) => void, private readonly render: () => void) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.previous = performance.now();
    this.frameId = requestAnimationFrame(this.tick);
  }

  stop(): void { this.running = false; cancelAnimationFrame(this.frameId); }
  setSpeed(speed: number): void { this.speed = Math.max(0.25, Math.min(10, speed)); }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    const rawDelta = Math.min(GAME_CONFIG.loop.maxFrameSeconds, (now - this.previous) / 1000);
    this.previous = now;
    this.accumulator += rawDelta * this.speed;
    while (this.accumulator >= GAME_CONFIG.loop.fixedStepSeconds) {
      this.update(GAME_CONFIG.loop.fixedStepSeconds);
      this.accumulator -= GAME_CONFIG.loop.fixedStepSeconds;
    }
    this.render();
    this.frameId = requestAnimationFrame(this.tick);
  };
}
