export type Screen = 'menu' | 'game' | 'settings' | 'gameover' | 'escaped' | 'exit';
export type GameStatus = 'exploring' | 'encounter' | 'paused' | 'gameover' | 'escaped';
export type Direction = 'forward' | 'back' | 'left' | 'right';
export type RoomId = 'reception' | 'mainCorridor' | 'westWing' | 'quietMaze' | 'floodedRoom' | 'maintenance' | 'threshold';
export type ItemId = 'accessCard' | 'almondWater' | 'ration' | 'fuse' | 'medkit';
export type HotspotId = 'receptionNote' | 'receptionDrawer' | 'vendingMachine' | 'cardReader' | 'waterBottle' | 'looseFuse' | 'toolbox' | 'breaker' | 'wallMarks';
export type EncounterAction = 'run' | 'hide';

export interface Stats { health: number; hunger: number; thirst: number }

export interface InventoryEntry { id: ItemId; quantity: number }

export interface Preferences {
  masterVolume: number;
  musicVolume: number;
  effectsVolume: number;
  jumpscareIntensity: number;
}

export interface Encounter {
  id: 'watcher' | 'crawler';
  name: string;
  prompt: string;
  hint: string;
  solution: EncounterAction;
  remaining: number;
}

export interface GameSave {
  position: RoomId;
  stats: Stats;
  inventory: InventoryEntry[];
  flags: Record<string, boolean>;
  discovered: RoomId[];
  moveCount: number;
  elapsed: number;
}

export interface SaveData {
  version: 2;
  updatedAt: string;
  game: GameSave | null;
  preferences: Preferences;
}
