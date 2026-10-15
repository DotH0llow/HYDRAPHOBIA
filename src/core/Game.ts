import { NIGHT_CONFIG } from '../config/nightConfig';
import type { RandomSource } from './SeededRandom';
import { SeededRandom } from './SeededRandom';
import { EventBus } from './EventBus';
import { EnergySystem } from '../systems/EnergySystem';
import { EnemySystem } from '../systems/EnemySystem';
import { GateSystem } from '../systems/GateSystem';
import { RitualSystem } from '../systems/RitualSystem';
import { TimeSystem } from '../systems/TimeSystem';
import type { EnemyId, EnemyState, GameSnapshot, GameStatus, RoomId, Side } from '../types';

export class Game {
  readonly events = new EventBus();
  readonly time: TimeSystem;
  readonly energy = new EnergySystem();
  readonly gates = new GateSystem();
  readonly enemies: EnemySystem;
  readonly ritual = new RitualSystem();
  status: GameStatus = 'idle';
  mirrorOpen = false;
  selectedRoom: RoomId = 'courtyard';
  lightActive: Side | null = null;
  lastDanger = '';
  readonly eventLog: string[] = [];
  defeatBy?: EnemyId;
  private ended = false;

  constructor(readonly night: number, random: RandomSource = new SeededRandom()) {
    const config = NIGHT_CONFIG[night] ?? NIGHT_CONFIG[1]!;
    this.time = new TimeSystem(config.duration);
    this.enemies = new EnemySystem(config.enemies, this.events, random);
    this.bindEvents();
  }

  start(): void { if (this.status === 'idle') this.status = 'playing'; }

  update(delta: number): void {
    if (this.status !== 'playing' || this.ended) return;
    if (this.time.update(delta)) { this.win(); return; }
    const depletedNow = this.energy.update(delta, {
      closedGates: this.gates.closedCount(), mirror: this.mirrorOpen, light: this.lightActive !== null,
    });
    if (depletedNow) {
      this.mirrorOpen = false; this.lightActive = null; this.gates.disableAll();
      this.events.emit('energy:empty', undefined);
    }
    this.gates.update(delta);
    this.ritual.update(delta);
    this.enemies.update(delta, { gateClosed: (side) => this.gates.gates[side].blocksAttack() });
  }

  toggleGate(side: Side): boolean {
    if (this.status !== 'playing') return false;
    const changed = this.gates.toggle(side, this.energy.value > 0);
    if (changed) this.events.emit('gate:changed', { side, state: this.gates.gates[side].state });
    return changed;
  }

  toggleMirror(): boolean {
    if (this.status !== 'playing' || this.energy.value <= 0) return false;
    this.mirrorOpen = !this.mirrorOpen;
    if (this.mirrorOpen) this.lightActive = null;
    return true;
  }

  selectRoom(room: RoomId): void { if (this.mirrorOpen) this.selectedRoom = room; }

  setLight(side: Side | null): void {
    if (this.status !== 'playing' || this.energy.value <= 0 || this.mirrorOpen) return;
    this.lightActive = this.lightActive === side ? null : side;
  }

  ringBell(): boolean | null {
    if (this.status !== 'playing' || this.night < 3 || this.energy.value <= 0) return null;
    const result = this.ritual.ringBell(this.enemies);
    if (result !== null) this.events.emit('ritual:bell', { effective: result });
    return result;
  }

  togglePause(): void {
    if (this.ended || !['playing', 'paused'].includes(this.status)) return;
    this.status = this.status === 'paused' ? 'playing' : 'paused';
    this.time.paused = this.status === 'paused';
  }

  setPaused(hidden: boolean): void {
    if (hidden && this.status === 'playing') this.togglePause();
  }

  debugSetEnergy(value: number): void { this.energy.set(value); }
  debugAdvance(seconds: number): void { this.time.setElapsed(this.time.elapsed + seconds); }
  debugForceEnemy(id: EnemyId, state: EnemyState, room?: RoomId): void { this.enemies.enemies[id].force(state, room); }

  snapshot(): GameSnapshot {
    return {
      status: this.status, night: this.night, elapsed: this.time.elapsed, duration: this.time.duration,
      hour: this.time.hour, energy: this.energy.value, maxEnergy: this.energy.maximum,
      mirrorOpen: this.mirrorOpen, selectedRoom: this.selectedRoom, lightActive: this.lightActive,
      gates: { west: this.gates.gates.west.snapshot(), east: this.gates.gates.east.snapshot() },
      enemies: this.enemies.active().map((enemy) => enemy.snapshot()),
      bellCooldown: this.ritual.cooldownRemaining, bellReady: this.ritual.ready,
      lastDanger: this.lastDanger, eventLog: [...this.eventLog], defeatBy: this.defeatBy,
    };
  }

  private bindEvents(): void {
    this.events.on('enemy:moved', ({ id, room }) => this.log(`${id} moveu-se para ${room}.`));
    this.events.on('enemy:danger', ({ message }) => { this.lastDanger = message; this.log(message); });
    this.events.on('enemy:attack', ({ id }) => this.lose(id as EnemyId));
    this.events.on('energy:empty', () => { this.lastDanger = 'A energia arcana se extinguiu. As defesas falharam.'; this.log(this.lastDanger); });
    this.events.on('ritual:bell', ({ effective }) => this.log(effective ? 'O sino rompeu o transe do Monge.' : 'O sino ecoou cedo demais — algo ouviu.'));
  }

  private log(message: string): void {
    this.eventLog.unshift(`[${this.time.hour}] ${message}`);
    this.eventLog.splice(8);
  }

  private win(): void {
    if (this.ended) return;
    this.ended = true; this.status = 'victory'; this.events.emit('game:victory', undefined);
  }

  private lose(id: EnemyId): void {
    if (this.ended) return;
    this.ended = true; this.status = 'defeat'; this.defeatBy = id; this.events.emit('game:defeat', { id });
  }
}
