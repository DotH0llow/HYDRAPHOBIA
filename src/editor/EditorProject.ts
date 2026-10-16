import type { ItemId } from '../types';
import type { EditorConnection, EditorHotspot, EditorHotspotAction, EditorLevel, EditorProjectData, EditorRoom } from './types';

export const EDITOR_STORAGE_KEY = 'limiar:room-editor:v1';

type EditorStorage = Pick<Storage, 'getItem' | 'setItem'>;

const cleanId = (value: string): string => value.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
const ITEMS = new Set<ItemId>(['accessCard', 'almondWater', 'ration', 'fuse', 'medkit']);
const ACTIONS = new Set<EditorHotspotAction>(['examine', 'collect', 'use', 'move', 'event']);
const EVENTS = new Set(['none', 'watcher', 'crawler', 'jumpscare']);

export const createId = (prefix: string): string => {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${random}`;
};

export const createRoom = (index = 0): EditorRoom => ({
  id: createId('sala'),
  name: `Sala ${index + 1}`,
  code: `NÍVEL 0 — ${String(index + 1).padStart(2, '0')}`,
  description: 'Descreva o que o jogador percebe ao entrar nesta perspectiva.',
  image: '/assets/scenes/reception.jpg',
  position: { x: 120 + (index % 3) * 300, y: 120 + Math.floor(index / 3) * 210 },
  hotspots: [],
});

export const createProject = (): EditorProjectData => {
  const firstRoom = createRoom();
  const levelId = createId('nivel');
  return {
    version: 1,
    name: 'Mapa Limiar',
    activeLevelId: levelId,
    updatedAt: new Date().toISOString(),
    levels: [{ id: levelId, name: 'Nível 0', startRoomId: firstRoom.id, rooms: [firstRoom], connections: [] }],
  };
};

export class EditorProject {
  data: EditorProjectData;

  constructor(
    private readonly storage: EditorStorage | null = typeof localStorage === 'undefined' ? null : localStorage,
    initial?: EditorProjectData,
  ) {
    this.data = initial ? this.validate(initial) : this.load();
  }

  get activeLevel(): EditorLevel {
    return this.data.levels.find((level) => level.id === this.data.activeLevelId) ?? this.data.levels[0]!;
  }

  findRoom(id: string): EditorRoom | undefined { return this.activeLevel.rooms.find((room) => room.id === id); }

  setActiveLevel(id: string): void {
    if (this.data.levels.some((level) => level.id === id)) this.data.activeLevelId = id;
  }

  addLevel(name = `Nível ${this.data.levels.length}`): EditorLevel {
    const room = createRoom();
    const level: EditorLevel = { id: createId('nivel'), name, startRoomId: room.id, rooms: [room], connections: [] };
    this.data.levels.push(level);
    this.data.activeLevelId = level.id;
    this.save();
    return level;
  }

  addRoom(): EditorRoom {
    const room = createRoom(this.activeLevel.rooms.length);
    this.activeLevel.rooms.push(room);
    if (!this.activeLevel.startRoomId) this.activeLevel.startRoomId = room.id;
    this.save();
    return room;
  }

  duplicateRoom(id: string): EditorRoom | null {
    const source = this.findRoom(id);
    if (!source) return null;
    const room: EditorRoom = structuredClone(source);
    room.id = createId('sala');
    room.name = `${source.name} — cópia`;
    room.position = { x: source.position.x + 48, y: source.position.y + 48 };
    room.hotspots = room.hotspots.map((hotspot) => ({ ...hotspot, id: createId('hotspot') }));
    this.activeLevel.rooms.push(room);
    this.save();
    return room;
  }

  deleteRoom(id: string): boolean {
    const level = this.activeLevel;
    if (level.rooms.length <= 1 || !level.rooms.some((room) => room.id === id)) return false;
    level.rooms = level.rooms.filter((room) => room.id !== id);
    level.connections = level.connections.filter((connection) => connection.from !== id && connection.to !== id);
    if (level.startRoomId === id) level.startRoomId = level.rooms[0]!.id;
    this.save();
    return true;
  }

  addConnection(from: string, to: string): EditorConnection | null {
    if (from === to || !this.findRoom(from) || !this.findRoom(to)) return null;
    const connection: EditorConnection = {
      id: createId('conexao'), from, to, label: 'Frente', direction: `caminho-${this.activeLevel.connections.length + 1}`, bidirectional: false,
    };
    this.activeLevel.connections.push(connection);
    this.save();
    return connection;
  }

  deleteConnection(id: string): void {
    this.activeLevel.connections = this.activeLevel.connections.filter((connection) => connection.id !== id);
    this.save();
  }

  addHotspot(roomId: string): EditorHotspot | null {
    const room = this.findRoom(roomId);
    if (!room) return null;
    const hotspot: EditorHotspot = {
      id: createId('hotspot'), label: 'Novo objeto', x: 38, y: 38, width: 18, height: 18,
      action: 'examine', message: 'Você examina o objeto.', once: false,
      highlightColor: '#d7df77', highlightOpacity: 0.22,
    };
    room.hotspots.push(hotspot);
    this.save();
    return hotspot;
  }

  deleteHotspot(roomId: string, hotspotId: string): void {
    const room = this.findRoom(roomId);
    if (!room) return;
    room.hotspots = room.hotspots.filter((hotspot) => hotspot.id !== hotspotId);
    this.save();
  }

  save(): boolean {
    this.data.updatedAt = new Date().toISOString();
    try { this.storage?.setItem(EDITOR_STORAGE_KEY, JSON.stringify(this.data)); return this.storage !== null; }
    catch { return false; }
  }

  replace(value: unknown): void {
    this.data = this.validate(value);
    this.save();
  }

  toJSON(): string { return JSON.stringify(this.data, null, 2); }

  private load(): EditorProjectData {
    try {
      const raw = this.storage?.getItem(EDITOR_STORAGE_KEY);
      return raw ? this.validate(JSON.parse(raw) as unknown) : createProject();
    } catch { return createProject(); }
  }

  private validate(value: unknown): EditorProjectData {
    if (!value || typeof value !== 'object') return createProject();
    const raw = value as Partial<EditorProjectData>;
    if (!Array.isArray(raw.levels) || raw.levels.length === 0) return createProject();
    const levels = raw.levels.map((level, levelIndex): EditorLevel => {
      const rawLevel = level as Partial<EditorLevel>;
      const rooms = Array.isArray(rawLevel.rooms) && rawLevel.rooms.length > 0
        ? rawLevel.rooms.map((room, roomIndex) => this.validateRoom(room, roomIndex))
        : [createRoom()];
      const roomIds = new Set(rooms.map((room) => room.id));
      const connections = Array.isArray(rawLevel.connections)
        ? rawLevel.connections.flatMap((value, index): EditorConnection[] => {
          if (!value || typeof value !== 'object') return [];
          const connection = value as Partial<EditorConnection>;
          if (!roomIds.has(String(connection.from)) || !roomIds.has(String(connection.to))) return [];
          const requiresItem = ITEMS.has(connection.requiresItem as ItemId) ? connection.requiresItem as ItemId : undefined;
          return [{
            id: cleanId(String(connection.id ?? `conexao-${index + 1}`)) || createId('conexao'),
            from: String(connection.from), to: String(connection.to),
            label: String(connection.label ?? 'Caminho'), direction: String(connection.direction ?? `caminho-${index + 1}`),
            bidirectional: connection.bidirectional === true, requiresItem,
            lockedMessage: typeof connection.lockedMessage === 'string' ? connection.lockedMessage : undefined,
          }];
        })
        : [];
      return {
        id: cleanId(String(rawLevel.id ?? `nivel-${levelIndex + 1}`)) || createId('nivel'),
        name: String(rawLevel.name ?? `Nível ${levelIndex}`),
        startRoomId: roomIds.has(String(rawLevel.startRoomId)) ? String(rawLevel.startRoomId) : rooms[0]!.id,
        rooms,
        connections,
      };
    });
    const activeLevelId = levels.some((level) => level.id === raw.activeLevelId) ? String(raw.activeLevelId) : levels[0]!.id;
    return { version: 1, name: String(raw.name ?? 'Mapa Limiar'), activeLevelId, updatedAt: String(raw.updatedAt ?? ''), levels };
  }

  private validateRoom(value: unknown, index: number): EditorRoom {
    const fallback = createRoom(index);
    if (!value || typeof value !== 'object') return fallback;
    const room = value as Partial<EditorRoom>;
    const position = room.position && typeof room.position === 'object' ? room.position : fallback.position;
    const number = (candidate: unknown, defaultValue: number): number => typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : defaultValue;
    return {
      id: cleanId(String(room.id ?? fallback.id)) || fallback.id,
      name: String(room.name ?? fallback.name), code: String(room.code ?? fallback.code),
      description: String(room.description ?? fallback.description), image: String(room.image ?? fallback.image),
      position: { x: number(position.x, fallback.position.x), y: number(position.y, fallback.position.y) },
      hotspots: Array.isArray(room.hotspots) ? room.hotspots.flatMap((hotspot, hotspotIndex) => this.validateHotspot(hotspot, hotspotIndex)) : [],
    };
  }

  private validateHotspot(value: unknown, index: number): EditorHotspot[] {
    if (!value || typeof value !== 'object') return [];
    const hotspot = value as Partial<EditorHotspot>;
    const number = (candidate: unknown, fallback: number, min: number, max: number): number => typeof candidate === 'number' && Number.isFinite(candidate) ? Math.max(min, Math.min(max, candidate)) : fallback;
    const action = ACTIONS.has(hotspot.action as EditorHotspotAction) ? hotspot.action as EditorHotspotAction : 'examine';
    const item = ITEMS.has(hotspot.item as ItemId) ? hotspot.item as ItemId : undefined;
    const requiresItem = ITEMS.has(hotspot.requiresItem as ItemId) ? hotspot.requiresItem as ItemId : undefined;
    const event = EVENTS.has(String(hotspot.event)) ? hotspot.event : undefined;
    const x = number(hotspot.x, 38, 0, 97);
    const y = number(hotspot.y, 38, 0, 97);
    return [{
      id: cleanId(String(hotspot.id ?? `hotspot-${index + 1}`)) || createId('hotspot'),
      label: String(hotspot.label ?? 'Objeto'), x, y,
      width: number(hotspot.width, 18, 3, 100 - x), height: number(hotspot.height, 18, 3, 100 - y),
      action, message: String(hotspot.message ?? 'Você examina o objeto.'), item, requiresItem,
      targetRoomId: typeof hotspot.targetRoomId === 'string' ? hotspot.targetRoomId : undefined,
      event, once: hotspot.once === true,
      highlightColor: typeof hotspot.highlightColor === 'string' && /^#[0-9a-f]{6}$/i.test(hotspot.highlightColor) ? hotspot.highlightColor : '#d7df77',
      highlightOpacity: number(hotspot.highlightOpacity, .22, .05, .65),
    }];
  }
}
