import { DEFAULT_WORLD } from '../config/world';
import type { AttackDefinition, AttackEffectId, ChallengeKind, ItemEffect, NpcPersonality } from '../config/world';
import type { RoomAudioMode } from '../config/world';
import type { CutsceneMediaType, EncounterAction, HotspotVisibility } from '../types';
import { EDITOR_STORAGE_KEY } from '../config/storage';
import { isLightShape } from '../systems/lighting';
import { syncToDisk } from '../systems/localSync';
import { createChallenge, createChallengeOutcome, createNpc, createNpcAnswer, createNpcLine, createRoomNpc, DEFAULT_ENTITIES, DEFAULT_ITEM_DRAWINGS, DEFAULT_ITEM_IMAGES, DEFAULT_ITEM_VALUES, DEFAULT_ITEMS, detectMediaType, isFullRoomView } from './types';
import type { EditorChallenge, EditorChallengeOutcome, EditorConnection, EditorEntity, EditorHotspot, EditorHotspotAction, EditorItem, EditorLevel, EditorLight, EditorNpc, EditorNpcAnswer, EditorNpcLine, EditorProjectData, EditorRoom, EditorRoomMedia, EditorRoomNpc, EditorRoomView } from './types';

export { EDITOR_STORAGE_KEY } from '../config/storage';

type EditorStorage = Pick<Storage, 'getItem' | 'setItem'>;

const cleanId = (value: string): string => value.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const ACTIONS = new Set<EditorHotspotAction>(['examine', 'collect', 'use', 'event', 'cutscene', 'hideout', 'challenge', 'npc']);

/**
 * Interagível de "Mudar de sala" dos projetos antigos. A ação deixou de existir: ao
 * carregar o projeto cada um destes vira uma conexão de verdade, no mesmo ponto da
 * cena, para que exista um único caminho entre salas com uma única aparência.
 */
interface LegacyMoveHotspot {
  action?: string;
  label?: unknown;
  targetRoomId?: unknown;
  targetLevelId?: unknown;
  arrowRotation?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  indicator?: { x?: unknown; y?: unknown };
}
const VISIBILITIES = new Set<HotspotVisibility>(['visible', 'hidden', 'invisible']);
const EFFECTS = new Set<ItemEffect>(['none', 'heal', 'hydrate', 'feed', 'light']);
const SOLUTIONS = new Set<EncounterAction>(['run', 'hide']);
const CUTSCENE_MEDIA_TYPES = new Set<CutsceneMediaType>(['image', 'gif', 'video']);
const CHALLENGE_KIND_IDS = new Set<ChallengeKind>(['wires']);
const ATTACK_EFFECT_IDS = new Set<AttackEffectId>(['bleed', 'panic', 'drop']);
const PERSONALITY_IDS = new Set<NpcPersonality>(['acolhedor', 'cordial', 'desconfiado', 'hostil']);
const WIRE_OUTPUTS = new Set(['A', 'B', 'C', 'D', 'E', 'F']);
const WIRE_CONNECTORS = new Set(['1', '2', '3', '4', '5', '6']);
const ROOM_AUDIO_MODE_IDS = new Set<RoomAudioMode>(['once', 'loop', 'every-entry']);

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
    npcs: [],
  };
};

/** Quantos passos de desfazer o editor guarda, e o que conta como um passo só. */
const HISTORY_LIMIT = 80;
const HISTORY_GROUP_MS = 700;

export class EditorProject {
  data: EditorProjectData;

  private readonly undoStack: string[] = [];
  private redoStack: string[] = [];
  private lastSnapshot = '';
  private lastHistoryAt = 0;
  private restoring = false;

  constructor(
    private readonly storage: EditorStorage | null = typeof localStorage === 'undefined' ? null : localStorage,
    initial?: EditorProjectData,
  ) {
    this.data = initial ? this.validate(initial) : this.load();
    // O estado de abertura é o fundo da pilha: o primeiro Ctrl+Z volta para cá.
    this.lastSnapshot = this.snapshot();
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

  /** Nome livre para um nível novo: nunca repete um nome já usado no projeto. */
  private uniqueLevelName(base: string): string {
    const used = new Set(this.data.levels.map((level) => level.name.trim().toLowerCase()));
    if (!used.has(base.trim().toLowerCase())) return base;
    for (let suffix = 2; suffix < 500; suffix += 1) {
      const candidate = `${base} (${suffix})`;
      if (!used.has(candidate.toLowerCase())) return candidate;
    }
    return `${base} ${Date.now()}`;
  }

  /** Nível novo e vazio: uma sala própria, nenhuma conexão e nenhuma sala antiga. */
  addLevel(name = `Nível ${this.data.levels.length}`): EditorLevel {
    const room = createRoom();
    const level: EditorLevel = { id: createId('nivel'), name: this.uniqueLevelName(name), startRoomId: room.id, rooms: [room], connections: [] };
    this.data.levels.push(level);
    this.data.activeLevelId = level.id;
    this.save();
    return level;
  }

  findLevel(id: string): EditorLevel | undefined { return this.data.levels.find((level) => level.id === id); }

  renameLevel(id: string, name: string): boolean {
    const level = this.findLevel(id);
    const clean = name.trim();
    if (!level || !clean) return false;
    level.name = clean.slice(0, 64);
    this.save();
    return true;
  }

  /**
   * Muda um nível de lugar na lista, antes ou depois de outro. A ordem é a do painel
   * e a do arquivo salvo, e nada do mapa depende dela: as conexões apontam para salas
   * por id, e o nível aberto é guardado por id também. Por isso mover é só mover.
   */
  moveLevel(id: string, targetId: string, before: boolean): boolean {
    if (id === targetId) return false;
    const levels = this.data.levels;
    const from = levels.findIndex((level) => level.id === id);
    if (from < 0 || !levels.some((level) => level.id === targetId)) return false;
    const [moved] = levels.splice(from, 1);
    // O alvo pode ter andado uma casa para trás quando o nível movido saiu da lista.
    const at = levels.findIndex((level) => level.id === targetId);
    levels.splice(before ? at : at + 1, 0, moved!);
    this.save();
    return true;
  }

  /** Remove um nível inteiro. O projeto nunca fica sem nenhum. */
  deleteLevel(id: string): boolean {
    if (this.data.levels.length <= 1) return false;
    const level = this.findLevel(id);
    if (!level) return false;
    this.data.levels = this.data.levels.filter((entry) => entry.id !== id);
    // Caminhos de outros níveis que apontavam para cá deixam de existir.
    const gone = new Set(level.rooms.map((room) => room.id));
    this.data.levels.forEach((entry) => {
      entry.connections = entry.connections.filter((connection) => !gone.has(connection.to));
    });
    if (this.data.activeLevelId === id) this.data.activeLevelId = this.data.levels[0]!.id;
    this.save();
    return true;
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
    room.lights = room.lights?.map((light) => ({ ...light, id: createId('luz') }));
    room.media = room.media?.map((media) => ({ ...media, id: createId('midia') }));
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
    // A direção sai do id, que é único: contar as conexões existentes repetia o nome
    // depois de qualquer exclusão, e dois caminhos da mesma sala com o mesmo nome
    // viravam um só no jogo.
    const id = createId('conexao');
    const connection: EditorConnection = {
      id, from, to, label: 'Frente', direction: `caminho-${id}`, bidirectional: false,
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
    const item: EditorItem = { id: createId('item'), name: 'Novo item', icon: '◆', description: 'Descreva o item.', useText: 'O item foi usado.', effect: 'none', effectAmount: 0, value: 1 };
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
    const entity: EditorEntity = { id: createId('entidade'), name: 'Nova entidade', prompt: 'Algo se aproxima no escuro.', hint: 'Decida rápido.', encounter: 'choice', solution: 'hide', timeLimit: 5, image: '/assets/entities/watcher.jpg', jumpscareSeconds: undefined };
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

  // --- NPCs ---

  findNpc(id: string): EditorNpc | undefined { return this.data.npcs.find((npc) => npc.id === id); }

  addNpc(): EditorNpc {
    const npc = createNpc(createId('npc'), createId('fala'));
    this.data.npcs.push(npc);
    this.save();
    return npc;
  }

  deleteNpc(id: string): boolean {
    if (!this.data.npcs.some((npc) => npc.id === id)) return false;
    this.data.npcs = this.data.npcs.filter((npc) => npc.id !== id);
    // Quem foi apagado não pode continuar plantado numa cena nem preso a um interagível.
    this.data.levels.forEach((level) => level.rooms.forEach((room) => {
      room.npcs = room.npcs?.filter((entry) => entry.npcId !== id);
      room.hotspots.forEach((hotspot) => { if (hotspot.npcId === id) hotspot.npcId = undefined; });
    }));
    this.save();
    return true;
  }

  addNpcLine(npcId: string): EditorNpcLine | null {
    const npc = this.findNpc(npcId);
    if (!npc) return null;
    const line = createNpcLine(createId('fala'));
    npc.lines.push(line);
    this.save();
    return line;
  }

  deleteNpcLine(npcId: string, lineId: string): boolean {
    const npc = this.findNpc(npcId);
    // A primeira fala é por onde a conversa começa: um NPC nunca fica sem nenhuma.
    if (!npc || npc.lines.length <= 1) return false;
    npc.lines = npc.lines.filter((line) => line.id !== lineId);
    npc.lines.forEach((line) => line.answers.forEach((answer) => { if (answer.to === lineId) answer.to = ''; }));
    this.save();
    return true;
  }

  addNpcAnswer(npcId: string, lineId: string): EditorNpcAnswer | null {
    const line = this.findNpc(npcId)?.lines.find((entry) => entry.id === lineId);
    // Três respostas é o que cabe no balão sem ele virar um menu.
    if (!line || line.answers.length >= 3) return null;
    const answer = createNpcAnswer(createId('resposta'));
    line.answers.push(answer);
    this.save();
    return answer;
  }

  deleteNpcAnswer(npcId: string, lineId: string, answerId: string): void {
    const line = this.findNpc(npcId)?.lines.find((entry) => entry.id === lineId);
    if (!line) return;
    line.answers = line.answers.filter((answer) => answer.id !== answerId);
    this.save();
  }

  /** Quantas unidades deste item o NPC carrega; zero tira o item da mochila dele. */
  setNpcStock(npcId: string, itemId: string, quantity: number): void {
    const npc = this.findNpc(npcId);
    if (!npc) return;
    const amount = Math.max(0, Math.min(99, Math.round(quantity)));
    const entry = npc.stock.find((item) => item.id === itemId);
    if (amount === 0) npc.stock = npc.stock.filter((item) => item.id !== itemId);
    else if (entry) entry.quantity = amount;
    else npc.stock.push({ id: itemId, quantity: amount });
    this.save();
  }

  /** Planta um NPC na cena aberta. */
  addRoomNpc(roomId: string, npcId: string): EditorRoomNpc | null {
    const room = this.findRoom(roomId);
    if (!room || !this.findNpc(npcId)) return null;
    const entry = createRoomNpc(createId('npc-cena'), npcId);
    room.npcs = [...(room.npcs ?? []), entry];
    this.save();
    return entry;
  }

  deleteRoomNpc(roomId: string, entryId: string): void {
    const room = this.findRoom(roomId);
    if (!room?.npcs) return;
    room.npcs = room.npcs.filter((entry) => entry.id !== entryId);
    this.save();
  }

  // --- ordem das listas ---

  /**
   * Arrastar qualquer uma das listas do projeto. A ordem é só a do painel: nada do
   * mapa depende dela, porque tudo aponta para tudo por id. Mover é, mesmo, só mover.
   */
  private reorder<T extends { id: string }>(list: T[], id: string, targetId: string, before: boolean): boolean {
    if (id === targetId) return false;
    const from = list.findIndex((entry) => entry.id === id);
    if (from < 0 || !list.some((entry) => entry.id === targetId)) return false;
    const [moved] = list.splice(from, 1);
    // O alvo pode ter andado uma casa para trás quando o item saiu da lista.
    const at = list.findIndex((entry) => entry.id === targetId);
    list.splice(before ? at : at + 1, 0, moved!);
    this.save();
    return true;
  }

  moveRoom(id: string, targetId: string, before: boolean): boolean { return this.reorder(this.activeLevel.rooms, id, targetId, before); }

  moveItem(id: string, targetId: string, before: boolean): boolean { return this.reorder(this.data.items, id, targetId, before); }

  moveEntity(id: string, targetId: string, before: boolean): boolean { return this.reorder(this.data.entities, id, targetId, before); }

  moveNpc(id: string, targetId: string, before: boolean): boolean { return this.reorder(this.data.npcs, id, targetId, before); }

  moveHotspot(roomId: string, id: string, targetId: string, before: boolean): boolean {
    const room = this.findRoom(roomId);
    return room ? this.reorder(room.hotspots, id, targetId, before) : false;
  }

  // --- desfazer e refazer ---

  /**
   * O projeto inteiro é um JSON só, então desfazer é guardar cópias dele. Gravações
   * muito próximas no tempo contam como um passo: sem isso, digitar um nome deixava
   * um passo de desfazer por letra, e voltar atrás de uma edição custava trinta Ctrl+Z.
   */
  private snapshot(): string { return JSON.stringify({ ...this.data, updatedAt: '' }); }

  private pushHistory(): void {
    if (this.restoring) return;
    const now = Date.now();
    const grouped = now - this.lastHistoryAt < HISTORY_GROUP_MS;
    if (this.lastSnapshot && !grouped) {
      this.undoStack.push(this.lastSnapshot);
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
      this.redoStack = [];
    }
    this.lastHistoryAt = now;
    this.lastSnapshot = this.snapshot();
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }

  get canRedo(): boolean { return this.redoStack.length > 0; }

  undo(): boolean {
    const previous = this.undoStack.pop();
    if (!previous) return false;
    this.redoStack.push(this.lastSnapshot);
    this.restoreSnapshot(previous);
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.lastSnapshot);
    this.restoreSnapshot(next);
    return true;
  }

  private restoreSnapshot(json: string): void {
    this.restoring = true;
    try {
      this.data = this.validate(JSON.parse(json) as unknown);
      this.save();
      this.lastSnapshot = this.snapshot();
      this.lastHistoryAt = 0;
    } catch { /* um passo ilegível simplesmente não volta */ }
    this.restoring = false;
  }

  save(): boolean {
    this.data.updatedAt = new Date().toISOString();
    this.pushHistory();
    // A cópia local em disco acompanha o mapa; em produção isto não faz nada.
    syncToDisk('project', this.data);
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
      /*
       * Um projeto gravado é devolvido como está. Aqui existia uma regra que, ao abrir,
       * reinjetava o nível de fábrica sempre que ele não fosse encontrado inteiro — e
       * apagar aquelas salas para montar a campanha de verdade virava impossível: elas
       * voltavam na abertura seguinte, do editor ou do jogo (que também lê o projeto),
       * com o "Nível 0" novo por cima e já ativo. O mapa de fábrica continua existindo
       * onde faz sentido: em `createProject`, no projeto que ainda não existe.
       */
      return raw ? this.validate(JSON.parse(raw) as unknown) : createProject();
    } catch { return createProject(); }
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
    // Os NPCs são do projeto inteiro, como os itens: a mesma pessoa pode estar em
    // duas salas de níveis diferentes sem ser escrita duas vezes.
    const finalNpcs = Array.isArray(raw.npcs) ? raw.npcs.flatMap((npc, index) => this.validateNpc(npc, index, itemIds)) : [];
    const npcIds = new Set(finalNpcs.map((npc) => npc.id));

    // Primeiro todas as salas de todos os níveis: um caminho pode levar a outro nível,
    // então as conexões só podem ser validadas depois que o projeto inteiro é conhecido.
    const drafts = raw.levels.map((level, levelIndex) => {
      const rawLevel = level as Partial<EditorLevel>;
      const rooms = Array.isArray(rawLevel.rooms) && rawLevel.rooms.length > 0
        ? rawLevel.rooms.map((room, roomIndex) => this.validateRoom(room, roomIndex, itemIds, eventIds, npcIds))
        : [createRoom()];
      return {
        rawLevel,
        rooms,
        roomIds: new Set(rooms.map((room) => room.id)),
        id: cleanId(String(rawLevel.id ?? `nivel-${levelIndex + 1}`)) || createId('nivel'),
        name: String(rawLevel.name ?? `Nível ${levelIndex}`),
      };
    });
    const levelIds = new Set(drafts.map((draft) => draft.id));
    const allRoomIds = new Set(drafts.flatMap((draft) => [...draft.roomIds]));

    const levels = drafts.map((draft): EditorLevel => {
      const { rawLevel, rooms, roomIds } = draft;
      const connections = Array.isArray(rawLevel.connections)
        ? rawLevel.connections.flatMap((value, index): EditorConnection[] => {
          if (!value || typeof value !== 'object') return [];
          const connection = value as Partial<EditorConnection>;
          if (!roomIds.has(String(connection.from))) return [];
          const toLevelId = typeof connection.toLevelId === 'string' && levelIds.has(connection.toLevelId) && connection.toLevelId !== draft.id
            ? connection.toLevelId
            : undefined;
          const reachable = toLevelId ? allRoomIds : roomIds;
          if (!reachable.has(String(connection.to))) return [];
          const requiresItem = itemIds.has(String(connection.requiresItem)) ? connection.requiresItem : undefined;
          const num = (candidate: unknown): number | undefined => typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined;
          return [{
            id: cleanId(String(connection.id ?? `conexao-${index + 1}`)) || createId('conexao'),
            from: String(connection.from), to: String(connection.to),
            toLevelId,
            label: String(connection.label ?? 'Caminho'), direction: String(connection.direction ?? `caminho-${index + 1}`),
            bidirectional: connection.bidirectional === true && !toLevelId,
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
        id: draft.id,
        name: draft.name,
        startRoomId: roomIds.has(String(rawLevel.startRoomId)) ? String(rawLevel.startRoomId) : rooms[0]!.id,
        escapeRoomId: roomIds.has(String(rawLevel.escapeRoomId)) ? String(rawLevel.escapeRoomId) : undefined,
        rooms,
        connections: [...connections, ...this.migratedMoveConnections(rawLevel, rooms, roomIds, levelIds, allRoomIds, draft.id)],
      };
    });
    const requestedActiveLevelId = cleanId(String(raw.activeLevelId ?? ''));
    const activeLevelId = levels.some((level) => level.id === requestedActiveLevelId) ? requestedActiveLevelId : levels[0]!.id;
    return { version: 1, name: String(raw.name ?? 'Mapa HYDRAPHOBIA'), activeLevelId, updatedAt: String(raw.updatedAt ?? ''), levels, items: finalItems, entities: finalEntities, npcs: finalNpcs };
  }

  /**
   * Converte os antigos interagíveis de "Mudar de sala" em conexões. O botão nasce
   * onde estava o círculo do interagível — a origem do bloco mais a posição do
   * indicador dentro dele — para o caminho continuar no mesmo ponto da cena.
   */
  private migratedMoveConnections(
    rawLevel: Partial<EditorLevel>,
    rooms: EditorRoom[],
    roomIds: Set<string>,
    levelIds: Set<string>,
    allRoomIds: Set<string>,
    levelId: string,
  ): EditorConnection[] {
    const rawRooms = Array.isArray(rawLevel.rooms) ? rawLevel.rooms : [];
    return rooms.flatMap((room, roomIndex) => {
      const rawRoom = rawRooms[roomIndex] as Partial<EditorRoom> | undefined;
      const hotspots = Array.isArray(rawRoom?.hotspots) ? rawRoom.hotspots : [];
      return hotspots.flatMap((value, index): EditorConnection[] => {
        if (!value || typeof value !== 'object') return [];
        const legacy = value as LegacyMoveHotspot;
        if (legacy.action !== 'move') return [];
        const toLevelId = typeof legacy.targetLevelId === 'string' && levelIds.has(legacy.targetLevelId) && legacy.targetLevelId !== levelId
          ? legacy.targetLevelId
          : undefined;
        const reachable = toLevelId ? allRoomIds : roomIds;
        const to = String(legacy.targetRoomId ?? '');
        if (!to || to === room.id || !reachable.has(to)) return [];
        const num = (candidate: unknown, fallback: number): number => typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : fallback;
        const anchor = (origin: unknown, size: unknown, inside: unknown): number => {
          const position = num(origin, 38) + (num(inside, 50) / 100) * num(size, 18);
          return Math.max(0, Math.min(100, Math.round(position * 10) / 10));
        };
        return [{
          id: createId('conexao'),
          from: room.id,
          to,
          toLevelId,
          label: String(legacy.label ?? 'Caminho'),
          direction: `caminho-${room.id}-${index + 1}`,
          bidirectional: false,
          buttonX: anchor(legacy.x, legacy.width, legacy.indicator?.x),
          buttonY: anchor(legacy.y, legacy.height, legacy.indicator?.y),
          arrowRotation: typeof legacy.arrowRotation === 'number' && Number.isFinite(legacy.arrowRotation) ? ((legacy.arrowRotation % 360) + 360) % 360 : undefined,
        }];
      });
    });
  }

  private validateRoom(value: unknown, index: number, itemIds: Set<string>, eventIds: Set<string>, npcIds: Set<string>): EditorRoom {
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
      hotspots: Array.isArray(room.hotspots) ? room.hotspots.flatMap((hotspot, hotspotIndex) => this.validateHotspot(hotspot, hotspotIndex, itemIds, eventIds, npcIds)) : [],
      darknessLevel: typeof room.darknessLevel === 'number' && Number.isFinite(room.darknessLevel) ? Math.max(0, Math.min(1, room.darknessLevel)) : undefined,
      lights: Array.isArray(room.lights) ? room.lights.flatMap((light, lightIndex) => this.validateLight(light, lightIndex)) : undefined,
      audio: this.validateRoomAudio(room.audio),
      media: Array.isArray(room.media) ? room.media.flatMap((entry, mediaIndex) => this.validateRoomMedia(entry, mediaIndex)) : undefined,
      view: this.validateRoomView(room.view),
      npcs: Array.isArray(room.npcs) ? room.npcs.flatMap((entry, npcIndex) => this.validateRoomNpc(entry, npcIndex, npcIds)) : undefined,
    };
  }

  /** Fotos, GIFs e vídeos soltos sobre a cena. Sem caminho a mídia não existe. */
  private validateRoomMedia(value: unknown, index: number): EditorRoomMedia[] {
    if (!value || typeof value !== 'object') return [];
    const raw = value as Partial<EditorRoomMedia>;
    const path = typeof raw.path === 'string' ? raw.path.trim() : '';
    if (!path) return [];
    const number = (candidate: unknown, fallback: number, min: number, max: number): number =>
      typeof candidate === 'number' && Number.isFinite(candidate) ? Math.max(min, Math.min(max, candidate)) : fallback;
    return [{
      id: cleanId(String(raw.id ?? `midia-${index + 1}`)) || createId('midia'),
      path,
      kind: CUTSCENE_MEDIA_TYPES.has(raw.kind as CutsceneMediaType) ? raw.kind as CutsceneMediaType : detectMediaType(path),
      x: number(raw.x, 30, -100, 200),
      y: number(raw.y, 30, -100, 200),
      width: number(raw.width, 40, 1, 400),
      height: number(raw.height, 40, 1, 400),
      opacity: number(raw.opacity, 1, 0.05, 1),
      rotation: ((Math.round(number(raw.rotation, 0, -3600, 3600)) % 360) + 360) % 360,
      loop: raw.loop !== false,
      onTop: raw.onTop === true,
    }];
  }

  /**
   * Campo de visão da sala. Uma janela degenerada (largura ou altura em zero) não
   * mostraria nada: nesses casos ela volta a ser a cena inteira, ou seja, nenhuma.
   */
  private validateRoomView(value: unknown): EditorRoomView | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const raw = value as Partial<EditorRoomView>;
    const number = (candidate: unknown, fallback: number, min: number, max: number): number =>
      typeof candidate === 'number' && Number.isFinite(candidate) ? Math.max(min, Math.min(max, candidate)) : fallback;
    const width = number(raw.width, 100, 5, 100);
    const height = number(raw.height, 100, 5, 100);
    const view: EditorRoomView = {
      x: number(raw.x, 0, 0, 100 - width),
      y: number(raw.y, 0, 0, 100 - height),
      width,
      height,
    };
    return isFullRoomView(view) ? undefined : view;
  }

  /** Trilha presa à sala: sem caminho de arquivo não existe configuração nenhuma. */
  private validateRoomAudio(value: unknown): EditorRoom['audio'] {
    if (!value || typeof value !== 'object') return undefined;
    const raw = value as Partial<NonNullable<EditorRoom['audio']>>;
    const path = typeof raw.path === 'string' ? raw.path.trim() : '';
    if (!path) return undefined;
    const volume = typeof raw.volume === 'number' && Number.isFinite(raw.volume) ? Math.max(0, Math.min(1, raw.volume)) : 1;
    return { path, mode: ROOM_AUDIO_MODE_IDS.has(raw.mode as RoomAudioMode) ? raw.mode as RoomAudioMode : 'every-entry', volume };
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
      aperture: number(raw.aperture, 360, 1, 360),
    }];
  }

  private validateHotspot(value: unknown, index: number, itemIds: Set<string>, eventIds: Set<string>, npcIds: Set<string>): EditorHotspot[] {
    if (!value || typeof value !== 'object') return [];
    const hotspot = value as Partial<EditorHotspot>;
    // "Mudar de sala" virou conexão: migratedMoveConnections já cuidou deste aqui.
    if ((value as LegacyMoveHotspot).action === 'move') return [];
    const number = (candidate: unknown, fallback: number, min: number, max: number): number => typeof candidate === 'number' && Number.isFinite(candidate) ? Math.max(min, Math.min(max, candidate)) : fallback;
    const action = ACTIONS.has(hotspot.action as EditorHotspotAction) ? hotspot.action as EditorHotspotAction : 'examine';
    const item = itemIds.has(String(hotspot.item)) ? hotspot.item : undefined;
    const requiresItem = itemIds.has(String(hotspot.requiresItem)) ? hotspot.requiresItem : undefined;
    const event = eventIds.has(String(hotspot.event)) ? hotspot.event : undefined;
    const x = number(hotspot.x, 38, -100, 100);
    const y = number(hotspot.y, 38, -100, 100);
    const visibility = VISIBILITIES.has(hotspot.visibility as HotspotVisibility) ? hotspot.visibility as HotspotVisibility : 'visible';
    const shapePoints = Array.isArray(hotspot.shapePoints) && hotspot.shapePoints.length >= 3
      ? hotspot.shapePoints.filter((point): point is { x: number; y: number } => Boolean(point) && typeof point === 'object' && typeof (point as { x?: unknown }).x === 'number' && typeof (point as { y?: unknown }).y === 'number').map((point) => ({ x: Math.max(-300, Math.min(400, point.x)), y: Math.max(-300, Math.min(400, point.y)) }))
      : undefined;
    const indicatorRaw = hotspot.indicator && typeof hotspot.indicator === 'object' ? hotspot.indicator : { x: 50, y: 50 };
    const indicator = { x: number(indicatorRaw.x, 50, -20, 120), y: number(indicatorRaw.y, 50, -20, 120) };
    const cutsceneMedia = CUTSCENE_MEDIA_TYPES.has(hotspot.cutsceneMedia as CutsceneMediaType) ? hotspot.cutsceneMedia as CutsceneMediaType : 'image';
    return [{
      id: cleanId(String(hotspot.id ?? `hotspot-${index + 1}`)) || createId('hotspot'),
      label: String(hotspot.label ?? 'Objeto'), x, y,
      width: number(hotspot.width, 18, 1, 400), height: number(hotspot.height, 18, 1, 400),
      action, message: String(hotspot.message ?? 'Você examina o objeto.'), item, requiresItem,
      grantsFlag: typeof hotspot.grantsFlag === 'string' ? hotspot.grantsFlag : undefined,
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
      sound: typeof hotspot.sound === 'string' && hotspot.sound ? hotspot.sound : undefined,
      soundVolume: typeof hotspot.sound === 'string' && hotspot.sound ? number(hotspot.soundVolume, 1, 0, 1) : undefined,
      challenge: action === 'challenge' ? this.validateChallenge(hotspot.challenge, itemIds) : undefined,
      npcId: action === 'npc' && npcIds.has(String(hotspot.npcId)) ? String(hotspot.npcId) : undefined,
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
      effectAmount: effect === 'none' || effect === 'light' ? 0 : number(item.effectAmount, 20, 1, 100),
      // Um mapa salvo antes das artes existirem ganha a imagem padrão do item.
      image: typeof item.image === 'string' && item.image ? item.image : DEFAULT_ITEM_IMAGES[id],
      // Como a imagem: um projeto gravado antes do desenho existir recebe o dele.
      drawing: typeof item.drawing === 'string' && item.drawing ? item.drawing : DEFAULT_ITEM_DRAWINGS[id],
      // Um item sem valor escrito vale 1 — nada no jogo é de graça, nem o que não serve.
      // Os itens de fábrica recebem o valor deles, e não o mínimo, ao abrir um projeto
      // gravado antes de a economia existir.
      value: Math.round(number(item.value, DEFAULT_ITEM_VALUES[id] ?? 1, 0, 999)),
      batterySeconds: effect === 'light' ? number(item.batterySeconds, 240, 10, 7200) : undefined,
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
      // Entidades gravadas antes de a mecânica do coração existir continuam na decisão.
      encounter: entity.encounter === 'heart' ? 'heart' : 'choice',
      solution: SOLUTIONS.has(entity.solution as EncounterAction) ? entity.solution as EncounterAction : 'hide',
      timeLimit: number(entity.timeLimit, 5, 1, 30),
      image: typeof entity.image === 'string' && entity.image ? entity.image : '/assets/entities/watcher.jpg',
      // `sceneImage` é como este campo se chamava enquanto o encontro tinha cena
      // própria; projetos gravados naquela época continuam abrindo com a parede certa.
      heartWall: typeof entity.heartWall === 'string' && entity.heartWall ? entity.heartWall
        : typeof (entity as { sceneImage?: unknown }).sceneImage === 'string' ? (entity as { sceneImage?: string }).sceneImage || undefined
        : undefined,
      jumpscareSeconds: typeof entity.jumpscareSeconds === 'number' && entity.jumpscareSeconds > 0 ? entity.jumpscareSeconds : undefined,
      heartHoldSeconds: typeof entity.heartHoldSeconds === 'number' ? number(entity.heartHoldSeconds, 17, 2, 120) : undefined,
      heartEscapeSeconds: typeof entity.heartEscapeSeconds === 'number' ? number(entity.heartEscapeSeconds, 21.4, 0.5, 120) : undefined,
      heartPull: typeof entity.heartPull === 'number' ? number(entity.heartPull, 46, 8, 160) : undefined,
      heartJoltEvery: typeof entity.heartJoltEvery === 'number' ? number(entity.heartJoltEvery, 2.4, 0.5, 20) : undefined,
      // A entidade da cena é resolvida pelo id na hora do encontro; aqui basta guardá-lo.
      heartEntity: typeof entity.heartEntity === 'string' && entity.heartEntity ? entity.heartEntity : undefined,
      attacks: Array.isArray(entity.attacks) ? entity.attacks.flatMap((attack, attackIndex) => this.validateAttack(attack, attackIndex)) : undefined,
    }];
  }

  /** Um golpe da lista de uma entidade. Sem dano e sem efeito ele não é golpe nenhum. */
  private validateAttack(value: unknown, index: number): AttackDefinition[] {
    if (!value || typeof value !== 'object') return [];
    const raw = value as Partial<AttackDefinition>;
    const number = (candidate: unknown, fallback: number, min: number, max: number): number => typeof candidate === 'number' && Number.isFinite(candidate) ? Math.max(min, Math.min(max, candidate)) : fallback;
    const effects = Array.isArray(raw.effects) ? raw.effects.filter((effect): effect is AttackEffectId => ATTACK_EFFECT_IDS.has(effect as AttackEffectId)) : [];
    const damage = Math.round(number(raw.damage, 20, 0, 100));
    if (damage === 0 && effects.length === 0) return [];
    return [{
      id: cleanId(String(raw.id ?? `golpe-${index + 1}`)) || createId('golpe'),
      name: String(raw.name ?? 'Golpe').slice(0, 48),
      damage,
      effects: [...new Set(effects)],
      bleedSeconds: effects.includes('bleed') ? number(raw.bleedSeconds, 25, 2, 600) : undefined,
      weight: number(raw.weight, 1, 0.1, 20),
    }];
  }

  /** O desafio preso a um interagível: a abertura, o painel e as duas consequências. */
  private validateChallenge(value: unknown, itemIds: Set<string>): EditorChallenge {
    const fallback = createChallenge();
    if (!value || typeof value !== 'object') return fallback;
    const raw = value as Partial<EditorChallenge>;
    const number = (candidate: unknown, base: number, min: number, max: number): number => typeof candidate === 'number' && Number.isFinite(candidate) ? Math.max(min, Math.min(max, candidate)) : base;
    const introPath = typeof raw.introPath === 'string' ? raw.introPath.trim() : '';
    // Duas letras não saem para o mesmo número, e um número não recebe dois fios.
    const pairs: Array<{ from: string; to: string }> = [];
    (Array.isArray(raw.wirePairs) ? raw.wirePairs : []).forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      const from = String((entry as { from?: unknown }).from ?? '').toUpperCase();
      const to = String((entry as { to?: unknown }).to ?? '');
      if (!WIRE_OUTPUTS.has(from) || !WIRE_CONNECTORS.has(to)) return;
      if (pairs.some((pair) => pair.from === from || pair.to === to)) return;
      pairs.push({ from, to });
    });
    return {
      kind: CHALLENGE_KIND_IDS.has(raw.kind as ChallengeKind) ? raw.kind as ChallengeKind : 'wires',
      introPath,
      introMedia: CUTSCENE_MEDIA_TYPES.has(raw.introMedia as CutsceneMediaType) ? raw.introMedia as CutsceneMediaType : detectMediaType(introPath),
      introSeconds: number(raw.introSeconds, 3.5, 0.2, 600),
      wireCount: Math.round(number(raw.wireCount, 4, 3, 6)),
      wirePairs: pairs,
      shockDamage: Math.round(number(raw.shockDamage, 3, 0, 100)),
      success: this.validateOutcome(raw.success, itemIds),
      giveUp: this.validateOutcome(raw.giveUp, itemIds),
    };
  }

  private validateOutcome(value: unknown, itemIds: Set<string>): EditorChallengeOutcome {
    const fallback = createChallengeOutcome();
    if (!value || typeof value !== 'object') return fallback;
    const raw = value as Partial<EditorChallengeOutcome>;
    const text = (candidate: unknown): string => typeof candidate === 'string' ? candidate : '';
    const sound = text(raw.sound).trim();
    return {
      message: text(raw.message),
      sound,
      soundVolume: typeof raw.soundVolume === 'number' && Number.isFinite(raw.soundVolume) ? Math.max(0, Math.min(1, raw.soundVolume)) : 1,
      image: text(raw.image).trim(),
      imageSeconds: typeof raw.imageSeconds === 'number' && Number.isFinite(raw.imageSeconds) ? Math.max(0.2, Math.min(600, raw.imageSeconds)) : 3.5,
      grantsFlag: text(raw.grantsFlag),
      item: itemIds.has(String(raw.item)) ? String(raw.item) : undefined,
    };
  }

  /** Onde um NPC está plantado em uma cena; sem NPC conhecido ele não fica em lugar nenhum. */
  private validateRoomNpc(value: unknown, index: number, npcIds: Set<string>): EditorRoomNpc[] {
    if (!value || typeof value !== 'object') return [];
    const raw = value as Partial<EditorRoomNpc>;
    const npcId = String(raw.npcId ?? '');
    if (!npcIds.has(npcId)) return [];
    const number = (candidate: unknown, fallback: number, min: number, max: number): number => typeof candidate === 'number' && Number.isFinite(candidate) ? Math.max(min, Math.min(max, candidate)) : fallback;
    return [{
      id: cleanId(String(raw.id ?? `npc-cena-${index + 1}`)) || createId('npc-cena'),
      npcId,
      x: number(raw.x, 50, -50, 150),
      y: number(raw.y, 58, -50, 150),
      height: number(raw.height, 42, 4, 200),
      flip: raw.flip === true,
      requiresFlag: typeof raw.requiresFlag === 'string' ? raw.requiresFlag : '',
    }];
  }

  private validateNpc(value: unknown, index: number, itemIds: Set<string>): EditorNpc[] {
    if (!value || typeof value !== 'object') return [];
    const raw = value as Partial<EditorNpc>;
    const id = cleanId(String(raw.id ?? `npc-${index + 1}`));
    if (!ID_PATTERN.test(id)) return [];
    const number = (candidate: unknown, fallback: number, min: number, max: number): number => typeof candidate === 'number' && Number.isFinite(candidate) ? Math.max(min, Math.min(max, candidate)) : fallback;
    const lines = Array.isArray(raw.lines) ? raw.lines.flatMap((line, lineIndex) => this.validateNpcLine(line, lineIndex, itemIds)) : [];
    const lineIds = new Set(lines.map((line) => line.id));
    // Uma resposta que apontava para uma fala apagada encerra a conversa em vez de
    // mandar o jogador para o nada.
    lines.forEach((line) => line.answers.forEach((answer) => { if (answer.to && !lineIds.has(answer.to)) answer.to = ''; }));
    return [{
      id,
      name: String(raw.name ?? 'Alguém').slice(0, 64),
      title: String(raw.title ?? '').slice(0, 64),
      art: typeof raw.art === 'string' ? raw.art.trim() : '',
      personality: PERSONALITY_IDS.has(raw.personality as NpcPersonality) ? raw.personality as NpcPersonality : 'cordial',
      reputation: Math.round(number(raw.reputation, 55, 0, 100)),
      trades: raw.trades !== false,
      stock: Array.isArray(raw.stock) ? raw.stock.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const itemId = String((entry as { id?: unknown }).id ?? '');
        if (!itemIds.has(itemId)) return [];
        return [{ id: itemId, quantity: Math.round(number((entry as { quantity?: unknown }).quantity, 1, 1, 99)) }];
      }) : [],
      lines: lines.length > 0 ? lines : [createNpcLine(createId('fala'))],
      voice: typeof raw.voice === 'string' ? raw.voice.trim() : '',
      // Zero é o automático; abaixo de 120px o balão não caberia nem uma linha.
      balloonWidth: Math.round(number(raw.balloonWidth, 0, 0, 1200)) || 0,
      balloonHeight: Math.round(number(raw.balloonHeight, 0, 0, 900)) || 0,
      balloonOpacity: number(raw.balloonOpacity, 1, 0.2, 1),
    }];
  }

  private validateNpcLine(value: unknown, index: number, itemIds: Set<string>): EditorNpcLine[] {
    if (!value || typeof value !== 'object') return [];
    const raw = value as Partial<EditorNpcLine>;
    const id = cleanId(String(raw.id ?? `fala-${index + 1}`)) || createId('fala');
    return [{
      id,
      text: String(raw.text ?? '').slice(0, 1200),
      answers: Array.isArray(raw.answers) ? raw.answers.flatMap((answer, answerIndex) => this.validateNpcAnswer(answer, answerIndex, itemIds)) : [],
    }];
  }

  private validateNpcAnswer(value: unknown, index: number, itemIds: Set<string>): EditorNpcAnswer[] {
    if (!value || typeof value !== 'object') return [];
    const raw = value as Partial<EditorNpcAnswer>;
    const number = (candidate: unknown, fallback: number, min: number, max: number): number => typeof candidate === 'number' && Number.isFinite(candidate) ? Math.max(min, Math.min(max, candidate)) : fallback;
    const item = (candidate: unknown): string | undefined => itemIds.has(String(candidate)) ? String(candidate) : undefined;
    return [{
      id: cleanId(String(raw.id ?? `resposta-${index + 1}`)) || createId('resposta'),
      text: String(raw.text ?? 'Nova resposta').slice(0, 240),
      to: typeof raw.to === 'string' ? cleanId(raw.to) : '',
      opensTrade: raw.opensTrade === true,
      requiresItem: item(raw.requiresItem),
      givesItem: item(raw.givesItem),
      takesItem: item(raw.takesItem),
      grantsFlag: typeof raw.grantsFlag === 'string' ? raw.grantsFlag : '',
      requiresFlag: typeof raw.requiresFlag === 'string' ? raw.requiresFlag : '',
      reputation: Math.round(number(raw.reputation, 0, -50, 50)),
    }];
  }
}
