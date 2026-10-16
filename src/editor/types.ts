import type { ItemId } from '../types';

export type EditorHotspotAction = 'examine' | 'collect' | 'use' | 'move' | 'event';
export type EditorEvent = 'none' | 'watcher' | 'crawler' | 'jumpscare';

export interface EditorPosition { x: number; y: number }

export interface EditorConnection {
  id: string;
  from: string;
  to: string;
  label: string;
  direction: string;
  bidirectional: boolean;
  requiresItem?: ItemId;
  lockedMessage?: string;
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
  targetRoomId?: string;
  event?: EditorEvent;
  once: boolean;
  highlightColor: string;
  highlightOpacity: number;
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
  rooms: EditorRoom[];
  connections: EditorConnection[];
}

export interface EditorProjectData {
  version: 1;
  name: string;
  activeLevelId: string;
  updatedAt: string;
  levels: EditorLevel[];
}

export const IMAGE_LIBRARY = [
  '/assets/scenes/reception.jpg',
  '/assets/scenes/corridor.jpg',
  '/assets/scenes/flooded.jpg',
  '/assets/scenes/maintenance.jpg',
] as const;

export const ITEM_OPTIONS: Array<{ id: ItemId; label: string }> = [
  { id: 'accessCard', label: 'Cartão sem nome' },
  { id: 'almondWater', label: 'Água de amêndoas' },
  { id: 'ration', label: 'Ração selada' },
  { id: 'fuse', label: 'Fusível industrial' },
  { id: 'medkit', label: 'Kit de primeiros socorros' },
];
