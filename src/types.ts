export type Screen = 'menu' | 'intro' | 'game' | 'victory' | 'defeat' | 'final' | 'settings' | 'credits';
export type Side = 'west' | 'east';
export type GateState = 'OPEN' | 'CLOSING' | 'CLOSED' | 'OPENING' | 'UNAVAILABLE';
export type EnemyId = 'hollowKnight' | 'veiledWidow' | 'blindMonk';
export type EnemyState = 'DORMANT' | 'PATROLLING' | 'APPROACHING' | 'AT_GATE' | 'ATTACKING' | 'RETREATING' | 'COOLDOWN' | 'STUNNED';
export type RoomId = 'courtyard' | 'chapel' | 'armory' | 'dungeon' | 'westCorridor' | 'eastCorridor' | 'westGate' | 'eastGate' | 'tower';
export type GameStatus = 'idle' | 'playing' | 'paused' | 'victory' | 'defeat';

export interface EnemySnapshot {
  id: EnemyId;
  name: string;
  state: EnemyState;
  room: RoomId;
  visible: boolean;
  threat: number;
}

export interface GateSnapshot {
  side: Side;
  state: GateState;
  progress: number;
}

export interface GameSnapshot {
  status: GameStatus;
  night: number;
  elapsed: number;
  duration: number;
  hour: string;
  energy: number;
  maxEnergy: number;
  mirrorOpen: boolean;
  selectedRoom: RoomId;
  lightActive: Side | null;
  gates: Record<Side, GateSnapshot>;
  enemies: EnemySnapshot[];
  bellCooldown: number;
  bellReady: boolean;
  lastDanger: string;
  eventLog: string[];
  defeatBy?: EnemyId;
}

export interface PlayerPreferences {
  volume: number;
  muted: boolean;
  reducedMotion: boolean;
  reducedFlashes: boolean;
}

export interface SaveData {
  version: 1;
  unlockedNight: number;
  completedNights: number[];
  bestResults: Partial<Record<number, { energy: number; completedAt: string }>>;
  preferences: PlayerPreferences;
}
