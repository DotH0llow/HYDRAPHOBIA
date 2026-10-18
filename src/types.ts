export type Screen = 'menu' | 'game' | 'settings' | 'gameover' | 'escaped' | 'exit';
export type GameStatus = 'exploring' | 'encounter' | 'paused' | 'gameover' | 'escaped' | 'cutscene' | 'hidden';
export type CutsceneMediaType = 'image' | 'gif' | 'video';
export type Direction = string;
export type RoomId = string;
export type ItemId = string;
export type HotspotId = string;
export type EncounterAction = 'run' | 'hide';
export type EntityId = string;
export type HotspotVisibility = 'visible' | 'hidden' | 'invisible';

export interface Stats { health: number; hunger: number; thirst: number; anxiety: number }

export interface InventoryEntry { id: ItemId; quantity: number }

export interface Preferences {
  masterVolume: number;
  musicVolume: number;
  effectsVolume: number;
  jumpscareIntensity: number;
  showHealthBar: boolean;
}

export interface Encounter {
  id: EntityId;
  name: string;
  prompt: string;
  hint: string;
  solution: EncounterAction;
  remaining: number;
  timeLimit: number;
  image: string;
  jumpscareDuration?: number;
}

export interface HideoutState {
  hotspotId: HotspotId;
  image?: string;
}

export interface CutsceneState {
  hotspotId: HotspotId;
  mediaType: CutsceneMediaType;
  mediaPath: string;
  holdSeconds: number;
  repeatCount: number;
  elapsed: number;
  loopsCompleted: number;
}

export interface GameSave {
  position: RoomId;
  stats: Stats;
  inventory: InventoryEntry[];
  flags: Record<string, boolean>;
  discovered: RoomId[];
  moveCount: number;
  elapsed: number;
  danger: number;
  roomTime: Record<RoomId, number>;
}

export interface SaveData {
  version: 2;
  updatedAt: string;
  game: GameSave | null;
  preferences: Preferences;
}
