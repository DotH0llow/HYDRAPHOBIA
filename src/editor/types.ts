import type { ItemEffect } from '../config/world';
import type { CutsceneMediaType, EncounterAction, EntityId, HotspotVisibility, ItemId } from '../types';

export type EditorHotspotAction = 'examine' | 'collect' | 'use' | 'move' | 'event' | 'cutscene' | 'hideout';
export type EditorEvent = 'none' | 'jumpscare' | EntityId;

export interface EditorPosition { x: number; y: number }

export interface EditorShapePoint { x: number; y: number }

export const DEFAULT_SHAPE_POINT_COUNT = 4;

export interface EditorConnection {
  id: string;
  from: string;
  to: string;
  label: string;
  direction: string;
  bidirectional: boolean;
  requiresFlag?: string;
  requiresItem?: ItemId;
  lockedMessage?: string;
  buttonX?: number;
  buttonY?: number;
  arrowRotation?: number;
}

export interface EditorHotspot {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  action: EditorHotspotAction;
  message: string;
  item?: ItemId;
  requiresItem?: ItemId;
  grantsFlag?: string;
  targetRoomId?: string;
  event?: EditorEvent;
  once: boolean;
  highlightColor: string;
  highlightOpacity: number;
  visibility: HotspotVisibility;
  revealSeconds: number;
  shapePoints?: EditorShapePoint[];
  indicator: EditorShapePoint;
  cutsceneMedia: CutsceneMediaType;
  cutscenePath: string;
  cutsceneHoldSeconds: number;
  cutsceneRepeatCount: number;
  hideoutImage?: string;
}

export interface EditorRoom {
  id: string;
  name: string;
  code: string;
  description: string;
  image: string;
  position: EditorPosition;
  hotspots: EditorHotspot[];
}

export interface EditorLevel {
  id: string;
  name: string;
  startRoomId: string;
  escapeRoomId?: string;
  rooms: EditorRoom[];
  connections: EditorConnection[];
}

export interface EditorItem {
  id: ItemId;
  name: string;
  icon: string;
  description: string;
  useText: string;
  effect: ItemEffect;
  effectAmount: number;
  image?: string;
}

export interface EditorEntity {
  id: EntityId;
  name: string;
  prompt: string;
  hint: string;
  solution: EncounterAction;
  timeLimit: number;
  image: string;
  jumpscareSeconds?: number;
}

export interface EditorProjectData {
  version: 1;
  name: string;
  activeLevelId: string;
  updatedAt: string;
  levels: EditorLevel[];
  items: EditorItem[];
  entities: EditorEntity[];
}

export const IMAGE_LIBRARY = [
  '/assets/scenes/reception.jpg',
  '/assets/scenes/corridor.jpg',
  '/assets/scenes/flooded.jpg',
  '/assets/scenes/maintenance.jpg',
] as const;

export const ENTITY_IMAGE_LIBRARY = [
  '/assets/entities/watcher.jpg',
  '/assets/entities/crawler.jpg',
] as const;

export const ASSET_FOLDERS = {
  scenes: 'public/assets/scenes',
  entities: 'public/assets/entities',
  items: 'public/assets/items',
  cutscenes: 'public/assets/cutscenes',
  icons: 'public/assets/icons',
} as const;

export const detectMediaType = (path: string): 'image' | 'gif' | 'video' => {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'gif') return 'gif';
  if (['mp4', 'webm', 'ogg', 'mov', 'avi'].includes(ext)) return 'video';
  return 'image';
};

export const DEFAULT_ITEMS: EditorItem[] = [
  { id: 'accessCard', name: 'Cartão sem nome', icon: '▣', description: 'Um cartão magnético amarelado. A tarja ainda parece intacta.', useText: 'Ele deve abrir algum leitor próximo.', effect: 'none', effectAmount: 0 },
  { id: 'almondWater', name: 'Água de amêndoas', icon: '◒', description: 'Uma garrafa lacrada. O líquido tem um cheiro doce e vagamente familiar.', useText: 'A sede recua. Por enquanto.', effect: 'hydrate', effectAmount: 58 },
  { id: 'ration', name: 'Ração selada', icon: '▰', description: 'Uma barra de emergência dura, mas ainda comestível.', useText: 'Sem gosto. Ainda assim, alimento.', effect: 'feed', effectAmount: 48 },
  { id: 'fuse', name: 'Fusível industrial', icon: '⌁', description: 'Pesado demais para o tamanho. Os contatos não estão oxidados.', useText: 'Talvez pertença a um painel elétrico.', effect: 'none', effectAmount: 0 },
  { id: 'medkit', name: 'Kit de primeiros socorros', icon: '✚', description: 'Gaze, antisséptico e analgésicos dentro do prazo.', useText: 'Os ferimentos foram tratados.', effect: 'heal', effectAmount: 52 },
];

export const DEFAULT_ENTITIES: EditorEntity[] = [
  { id: 'watcher', name: 'O Observador', prompt: 'Uma silhueta bloqueia o corredor. Ela reage a movimento.', hint: 'Talvez seja melhor desaparecer da visão.', solution: 'hide', timeLimit: 5, image: '/assets/entities/watcher.jpg' },
  { id: 'crawler', name: 'O Rastejante', prompt: 'Unhas batem no concreto atrás de você. Está se aproximando.', hint: 'Ficar parado significa ser alcançado.', solution: 'run', timeLimit: 4.2, image: '/assets/entities/crawler.jpg' },
];
