export type Screen = 'menu' | 'slots' | 'create' | 'game' | 'settings' | 'gameover' | 'escaped' | 'exit';
export type GameStatus = 'exploring' | 'encounter' | 'paused' | 'gameover' | 'escaped' | 'cutscene' | 'hidden';
export type CutsceneMediaType = 'image' | 'gif' | 'video';
export type Direction = string;
export type RoomId = string;
export type ItemId = string;
export type HotspotId = string;
export type EncounterAction = 'run' | 'hide';
export type EntityId = string;
export type HotspotVisibility = 'visible' | 'hidden' | 'invisible';

export type CharacterGender = 'male' | 'female';
export type CharacterClassId = 'explorador' | 'tecnico' | 'adolescente' | 'cavaleiro';
export type PhobiaId = 'nictofobia' | 'claustrofobia' | 'hemofobia' | 'monofobia';

/** Quantidade de campanhas paralelas que o jogador pode manter. */
export const SAVE_SLOT_COUNT = 4;

export interface Stats { health: number; hunger: number; thirst: number; anxiety: number }

export interface InventoryEntry { id: ItemId; quantity: number }

export interface Preferences {
  masterVolume: number;
  musicVolume: number;
  effectsVolume: number;
  /** Volume só das vocalizações do personagem (respiração, fome, sede, gritos). */
  voiceVolume: number;
  jumpscareIntensity: number;
  showHealthBar: boolean;
}

export interface CharacterProfile {
  name: string;
  gender: CharacterGender;
  classId: CharacterClassId;
  phobia: PhobiaId;
  startingItem: ItemId;
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

/** Uma campanha: o personagem criado pelo jogador e o progresso dele. */
export interface SaveSlot {
  character: CharacterProfile;
  game: GameSave | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveData {
  version: 3;
  updatedAt: string;
  /** Índice do slot em uso, ou `null` quando o jogador está no menu. */
  activeSlot: number | null;
  /** Sempre `SAVE_SLOT_COUNT` posições; `null` é um slot vazio. */
  slots: Array<SaveSlot | null>;
  preferences: Preferences;
}
