import { DEFAULT_WORLD } from '../config/world';
import type { ItemEffect } from '../config/world';
import type { CutsceneMediaType, EncounterAction, HotspotVisibility } from '../types';
import { isLightShape } from '../systems/lighting';
import { DEFAULT_ENTITIES, DEFAULT_ITEMS } from './types';
import type { EditorConnection, EditorEntity, EditorHotspot, EditorHotspotAction, EditorItem, EditorLevel, EditorLight, EditorProjectData, EditorRoom } from './types';

export const EDITOR_STORAGE_KEY = 'limiar:room-editor:v1';

type EditorStorage = Pick<Storage, 'getItem' | 'setItem'>;

const cleanId = (value: string): string => value.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const ACTIONS = new Set<EditorHotspotAction>(['examine', 'collect', 'use', 'move', 'event', 'cutscene', 'hideout']);
const VISIBILITIES = new Set<HotspotVisibility>(['visible', 'hidden', 'invisible']);
const EFFECTS = new Set<ItemEffect>(['none', 'heal', 'hydrate', 'feed']);
const SOLUTIONS = new Set<EncounterAction>(['run', 'hide']);
const CUTSCENE_MEDIA_TYPES = new Set<CutsceneMediaType>(['image', 'gif', 'video']);

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
  const levelId = 'nivel-0';
  const rooms = Object.values(DEFAULT_WORLD.rooms).map((room, index): EditorRoom => ({
    id: room.id,
    name: room.name,
    code: room.code,
    description: room.description,
    image: room.image,
    position: { x: 100 + (index % 3) * 320, y: 90 + Math.floor(index / 3) * 230 },
    hotspots: room.hotspots.map((hotspot) => ({
      id: hotspot.id,
      label: hotspot.label,
      x: hotspot.x,
      y: hotspot.y,
      width: hotspot.width,
      height: hotspot.height,
      action: hotspot.kind,
      message: hotspot.message,
      item: hotspot.item,
      requiresItem: hotspot.requiresItem,
      grantsFlag: hotspot.grantsFlag,
      targetRoomId: hotspot.targetRoom,
      event: hotspot.event,
      once: hotspot.once === true,
      highlightColor: hotspot.highlight?.color ?? '#d7df77',
      highlightOpacity: hotspot.highlight?.opacity ?? .22,
      visibility: hotspot.visibility ?? 'visible',
      revealSeconds: hotspot.revealSeconds ?? 25,
      shapePoints: hotspot.shape?.points,
      indicator: hotspot.indicator ?? { x: 50, y: 50 },
      cutsceneMedia: hotspot.cutsceneMedia ?? 'image',
      cutscenePath: hotspot.cutscenePath ?? '',
      cutsceneHoldSeconds: hotspot.cutsceneHoldSeconds ?? 4,
      cutsceneRepeatCount: hotspot.cutsceneRepeatCount ?? 1,
    })),
  }));
  const connections = Object.values(DEFAULT_WORLD.rooms).flatMap((room) => Object.entries(room.exits).map(([direction, exit], index): EditorConnection => ({
    id: `conexao-${room.id}-${direction}-${index}`,
    from: room.id,
    to: exit.to,
    label: exit.label,
    direction,
    bidirectional: false,
    requiresFlag: exit.requires,
    requiresItem: exit.requiresItem,
    lockedMessage: exit.lockedMessage,
  })));
  return {
    version: 1,
    name: 'Mapa HYDRAPHOBIA',
    activeLevelId: levelId,
    updatedAt: new Date().toISOString(),
    levels: [{ id: levelId, name: 'Nível 0', startRoomId: DEFAULT_WORLD.startRoomId, escapeRoomId: DEFAULT_WORLD.escapeRoomId, rooms, connections }],
    items: structuredClone(DEFAULT_ITEMS),
    entities: structuredClone(DEFAULT_ENTITIES),
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
    if (this.data.levels.some((level) => level.id === id)) {
      this.data.activeLevelId = id;
      this.save();
    }
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
    if (level.escapeRoomId === id) level.escapeRoomId = undefined;
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
      visibility: 'visible', revealSeconds: 25,
      indicator: { x: 50, y: 50 },
      cutsceneMedia: 'image', cutscenePath: '', cutsceneHoldSeconds: 4, cutsceneRepeatCount: 1,
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

  findItem(id: string): EditorItem | undefined { return this.data.items.find((item) => item.id === id); }

  addItem(): EditorItem {
    const item: EditorItem = { id: createId('item'), name: 'Novo item', icon: '◆', description: 'Descreva o item.', useText: 'O item foi usado.', effect: 'none', effectAmount: 0 };
    this.data.items.push(item);
    this.save();
    return item;
  }

  deleteItem(id: string): boolean {
    if (this.data.items.length <= 1 || !this.data.items.some((item) => item.id === id)) return false;
    this.data.items = this.data.items.filter((item) => item.id !== id);
    this.save();
    return true;
  }

  findEntity(id: string): EditorEntity | undefined { return this.data.entities.find((entity) => entity.id === id); }

  addEntity(): EditorEntity {
    const entity: EditorEntity = { id: createId('entidade'), name: 'Nova entidade', prompt: 'Algo se aproxima no escuro.', hint: 'Decida rápido.', solution: 'hide', timeLimit: 5, image: '/assets/entities/watcher.jpg', jumpscareSeconds: undefined };
    this.data.entities.push(entity);
    this.save();
    return entity;
  }

  deleteEntity(id: string): boolean {
    if (this.data.entities.length <= 1 || !this.data.entities.some((entity) => entity.id === id)) return false;
    this.data.entities = this.data.entities.filter((entity) => entity.id !== id);
    this.save();
    return true;
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
      return raw ? this.ensureBuiltInMap(this.validate(JSON.parse(raw) as unknown)) : createProject();
    } catch { return createProject(); }
  }

  private ensureBuiltInMap(data: EditorProjectData): EditorProjectData {
    const builtInRoomIds = Object.keys(DEFAULT_WORLD.rooms);
    if (data.levels.some((level) => builtInRoomIds.every((id) => level.rooms.some((room) => room.id === id)))) return data;
    const builtIn = createProject().levels[0]!;
    while (data.levels.some((level) => level.id === builtIn.id)) builtIn.id = createId('nivel-jogo');
    builtIn.name = 'Nível 0 — jogo atual';
    data.levels.unshift(builtIn);
    data.activeLevelId = builtIn.id;
    this.data = data;
    this.save();
    return data;
  }

  private validate(value: unknown): EditorProjectData {
    if (!value || typeof value !== 'object') return createProject();
    const raw = value as Partial<EditorProjectData>;
    if (!Array.isArray(raw.levels) || raw.levels.length === 0) return createProject();

    const items = Array.isArray(raw.items) ? raw.items.flatMap((item, index) => this.validateItem(item, index)) : [];
    const finalItems = items.length > 0 ? items : structuredClone(DEFAULT_ITEMS);
    const itemIds = new Set(finalItems.map((item) => item.id));

    const entities = Array.isArray(raw.entities) ? raw.entities.flatMap((entity, index) => this.validateEntity(entity, index)) : [];
    const finalEntities = entities.length > 0 ? entities : structuredClone(DEFAULT_ENTITIES);
    const eventIds = new Set<string>(['none', 'jumpscare', ...finalEntities.map((entity) => entity.id)]);

    const levels = raw.levels.map((level, levelIndex): EditorLevel => {
      const rawLevel = level as Partial<EditorLevel>;
      const rooms = Array.isArray(rawLevel.rooms) && rawLevel.rooms.length > 0
        ? rawLevel.rooms.map((room, roomIndex) => this.validateRoom(room, roomIndex, itemIds, eventIds))
        : [createRoom()];
      const roomIds = new Set(rooms.map((room) => room.id));
      const connections = Array.isArray(rawLevel.connections)
        ? rawLevel.connections.flatMap((value, index): EditorConnection[] => {
          if (!value || typeof value !== 'object') return [];
          const connection = value as Partial<EditorConnection>;
          if (!roomIds.has(String(connection.from)) || !roomIds.has(String(connection.to))) return [];
          const requiresItem = itemIds.has(String(connection.requiresItem)) ? connection.requiresItem : undefined;
          const num = (candidate: unknown): number | undefined => typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined;
          return [{
            id: cleanId(String(connection.id ?? `conexao-${index + 1}`)) || createId('conexao'),
            from: String(connection.from), to: String(connection.to),
            label: String(connection.label ?? 'Caminho'), direction: String(connection.direction ?? `caminho-${index + 1}`),
            bidirectional: connection.bidirectional === true,
            requiresFlag: typeof connection.requiresFlag === 'string' ? connection.requiresFlag : undefined,
            requiresItem,
            lockedMessage: typeof connection.lockedMessage === 'string' ? connection.lockedMessage : undefined,
            buttonX: num(connection.buttonX) !== undefined ? Math.max(0, Math.min(100, num(connection.buttonX)!)) : undefined,
            buttonY: num(connection.buttonY) !== undefined ? Math.max(0, Math.min(100, num(connection.buttonY)!)) : undefined,
            arrowRotation: num(connection.arrowRotation) !== undefined ? ((num(connection.arrowRotation)! % 360) + 360) % 360 : undefined,
          }];
        })
        : [];
      return {
        id: cleanId(String(rawLevel.id ?? `nivel-${levelIndex + 1}`)) || createId('nivel'),
        name: String(rawLevel.name ?? `Nível ${levelIndex}`),
        startRoomId: roomIds.has(String(rawLevel.startRoomId)) ? String(rawLevel.startRoomId) : rooms[0]!.id,
        escapeRoomId: roomIds.has(String(rawLevel.escapeRoomId)) ? String(rawLevel.escapeRoomId) : undefined,
        rooms,
        connections,
      };
    });
    const requestedActiveLevelId = cleanId(String(raw.activeLevelId ?? ''));
    const activeLevelId = levels.some((level) => level.id === requestedActiveLevelId) ? requestedActiveLevelId : levels[0]!.id;
    return { version: 1, name: String(raw.name ?? 'Mapa HYDRAPHOBIA'), activeLevelId, updatedAt: String(raw.updatedAt ?? ''), levels, items: finalItems, entities: finalEntities };
  }

  private validateRoom(value: unknown, index: number, itemIds: Set<string>, eventIds: Set<string>): EditorRoom {
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
      hotspots: Array.isArray(room.hotspots) ? room.hotspots.flatMap((hotspot, hotspotIndex) => this.validateHotspot(hotspot, hotspotIndex, itemIds, eventIds)) : [],
      darknessLevel: typeof room.darknessLevel === 'number' && Number.isFinite(room.darknessLevel) ? Math.max(0, Math.min(1, room.darknessLevel)) : undefined,
      lights: Array.isArray(room.lights) ? room.lights.flatMap((light, lightIndex) => this.validateLight(light, lightIndex)) : undefined,
    };
  }

  /** Focos de luz da sala: perdiam-se a cada recarregamento antes desta validação existir. */
  private validateLight(value: unknown, index: number): EditorLight[] {
    if (!value || typeof value !== 'object') return [];
    const raw = value as Partial<EditorLight>;
    const number = (candidate: unknown, fallback: number, min: number, max: number): number =>
      typeof candidate === 'number' && Number.isFinite(candidate) ? Math.max(min, Math.min(max, candidate)) : fallback;
    return [{
      id: cleanId(String(raw.id ?? `luz-${index + 1}`)) || createId('luz'),
      x: number(raw.x, 50, 0, 100),
      y: number(raw.y, 50, 0, 100),
      radius: number(raw.radius, 20, 2, 60),
      intensity: number(raw.intensity, 0.9, 0, 1),
      color: typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : '#fffbe8',
      angle: ((number(raw.angle, 0, -3600, 3600) % 360) + 360) % 360,
      shape: isLightShape(raw.shape) ? raw.shape : 'circle',
      flicker: number(raw.flicker, 0, 0, 1),
    }];
  }

  private validateHotspot(value: unknown, index: number, itemIds: Set<string>, eventIds: Set<string>): EditorHotspot[] {
    if (!value || typeof value !== 'object') return [];
    const hotspot = value as Partial<EditorHotspot>;
    const number = (candidate: unknown, fallback: number, min: number, max: number): number => typeof candidate === 'number' && Number.isFinite(candidate) ? Math.max(min, Math.min(max, candidate)) : fallback;
    const action = ACTIONS.has(hotspot.action as EditorHotspotAction) ? hotspot.action as EditorHotspotAction : 'examine';
    const item = itemIds.has(String(hotspot.item)) ? hotspot.item : undefined;
    const requiresItem = itemIds.has(String(hotspot.requiresItem)) ? hotspot.requiresItem : undefined;
    const event = eventIds.has(String(hotspot.event)) ? hotspot.event : undefined;
    const x = number(hotspot.x, 38, 0, 97);
    const y = number(hotspot.y, 38, 0, 97);
    const visibility = VISIBILITIES.has(hotspot.visibility as HotspotVisibility) ? hotspot.visibility as HotspotVisibility : 'visible';
    const shapePoints = Array.isArray(hotspot.shapePoints) && hotspot.shapePoints.length >= 3
      ? hotspot.shapePoints.filter((point): point is { x: number; y: number } => Boolean(point) && typeof point === 'object' && typeof (point as { x?: unknown }).x === 'number' && typeof (point as { y?: unknown }).y === 'number').map((point) => ({ x: Math.max(-20, Math.min(120, point.x)), y: Math.max(-20, Math.min(120, point.y)) }))
      : undefined;
    const indicatorRaw = hotspot.indicator && typeof hotspot.indicator === 'object' ? hotspot.indicator : { x: 50, y: 50 };
    const indicator = { x: number(indicatorRaw.x, 50, -20, 120), y: number(indicatorRaw.y, 50, -20, 120) };
    const cutsceneMedia = CUTSCENE_MEDIA_TYPES.has(hotspot.cutsceneMedia as CutsceneMediaType) ? hotspot.cutsceneMedia as CutsceneMediaType : 'image';
    return [{
      id: cleanId(String(hotspot.id ?? `hotspot-${index + 1}`)) || createId('hotspot'),
      label: String(hotspot.label ?? 'Objeto'), x, y,
      width: number(hotspot.width, 18, 3, 100 - x), height: number(hotspot.height, 18, 3, 100 - y),
      action, message: String(hotspot.message ?? 'Você examina o objeto.'), item, requiresItem,
      grantsFlag: typeof hotspot.grantsFlag === 'string' ? hotspot.grantsFlag : undefined,
      targetRoomId: typeof hotspot.targetRoomId === 'string' ? hotspot.targetRoomId : undefined,
      arrowRotation: typeof hotspot.arrowRotation === 'number' && Number.isFinite(hotspot.arrowRotation) ? ((hotspot.arrowRotation % 360) + 360) % 360 : undefined,
      event, once: hotspot.once === true,
      highlightColor: typeof hotspot.highlightColor === 'string' && /^#[0-9a-f]{6}$/i.test(hotspot.highlightColor) ? hotspot.highlightColor : '#d7df77',
      highlightOpacity: number(hotspot.highlightOpacity, .22, .05, .65),
      visibility,
      revealSeconds: number(hotspot.revealSeconds, 25, 1, 3600),
      shapePoints: shapePoints && (shapePoints.length >= 3 ? shapePoints : undefined),
      indicator,
      cutsceneMedia,
      cutscenePath: typeof hotspot.cutscenePath === 'string' ? hotspot.cutscenePath : '',
      cutsceneHoldSeconds: number(hotspot.cutsceneHoldSeconds, 4, 0.2, 600),
      cutsceneRepeatCount: Math.round(number(hotspot.cutsceneRepeatCount, 1, 1, 100)),
      hideoutImage: typeof hotspot.hideoutImage === 'string' ? hotspot.hideoutImage : undefined,
    }];
  }

  private validateItem(value: unknown, index: number): EditorItem[] {
    if (!value || typeof value !== 'object') return [];
    const item = value as Partial<EditorItem>;
    const id = cleanId(String(item.id ?? `item-${index + 1}`));
    if (!ID_PATTERN.test(id)) return [];
    const number = (candidate: unknown, fallback: number, min: number, max: number): number => typeof candidate === 'number' && Number.isFinite(candidate) ? Math.max(min, Math.min(max, candidate)) : fallback;
    const effect = EFFECTS.has(item.effect as ItemEffect) ? item.effect as ItemEffect : 'none';
    return [{
      id,
      name: String(item.name ?? 'Item sem nome'),
      icon: String(item.icon ?? '◆').slice(0, 4) || '◆',
      description: String(item.description ?? 'Um objeto comum.'),
      useText: String(item.useText ?? 'O item foi usado.'),
      effect,
      effectAmount: effect === 'none' ? 0 : number(item.effectAmount, 20, 1, 100),
      image: typeof item.image === 'string' && item.image ? item.image : undefined,
    }];
  }

  private validateEntity(value: unknown, index: number): EditorEntity[] {
    if (!value || typeof value !== 'object') return [];
    const entity = value as Partial<EditorEntity>;
    const id = cleanId(String(entity.id ?? `entidade-${index + 1}`));
    if (!ID_PATTERN.test(id)) return [];
    const number = (candidate: unknown, fallback: number, min: number, max: number): number => typeof candidate === 'number' && Number.isFinite(candidate) ? Math.max(min, Math.min(max, candidate)) : fallback;
    return [{
      id,
      name: String(entity.name ?? 'Entidade sem nome'),
      prompt: String(entity.prompt ?? 'Algo se aproxima no escuro.'),
      hint: String(entity.hint ?? 'Decida rápido.'),
      solution: SOLUTIONS.has(entity.solution as EncounterAction) ? entity.solution as EncounterAction : 'hide',
      timeLimit: number(entity.timeLimit, 5, 1, 30),
      image: typeof entity.image === 'string' && entity.image ? entity.image : '/assets/entities/watcher.jpg',
      jumpscareSeconds: typeof entity.jumpscareSeconds === 'number' && entity.jumpscareSeconds > 0 ? entity.jumpscareSeconds : undefined,
    }];
  }
}
