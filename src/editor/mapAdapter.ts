import type { ChallengeDefinition, ChallengeOutcome, EntityDefinition, HotspotDefinition, ItemDefinition, NpcDefinition, RoomDefinition, WorldDefinition } from '../config/world';
import type { EntityId, ItemId, NpcId } from '../types';
import { isFullRoomView, type EditorChallenge, type EditorChallengeOutcome, type EditorEntity, type EditorHotspot, type EditorItem, type EditorLevel, type EditorNpc } from './types';

/** Uma consequência sem nada escrito nela é consequência nenhuma: não vai ao jogo. */
const outcomeToRuntime = (outcome: EditorChallengeOutcome): ChallengeOutcome | undefined => {
  const message = outcome.message.trim();
  const sound = outcome.sound.trim();
  const image = outcome.image.trim();
  const grantsFlag = outcome.grantsFlag.trim();
  if (!message && !sound && !image && !grantsFlag && !outcome.item) return undefined;
  return {
    message: message || undefined,
    sound: sound || undefined,
    soundVolume: sound ? outcome.soundVolume : undefined,
    image: image || undefined,
    imageSeconds: image ? outcome.imageSeconds : undefined,
    grantsFlag: grantsFlag || undefined,
    item: outcome.item,
  };
};

const challengeToRuntime = (challenge: EditorChallenge): ChallengeDefinition => ({
  kind: challenge.kind,
  introPath: challenge.introPath || undefined,
  introMedia: challenge.introPath ? challenge.introMedia : undefined,
  introSeconds: challenge.introPath ? challenge.introSeconds : undefined,
  wireCount: challenge.wireCount,
  // Menos de três ligações escritas não fazem um painel: o jogo sorteia o dele.
  wirePairs: challenge.wirePairs.length >= 3 ? challenge.wirePairs.map((pair) => ({ ...pair })) : undefined,
  shockDamage: challenge.shockDamage,
  success: outcomeToRuntime(challenge.success),
  giveUp: outcomeToRuntime(challenge.giveUp),
});

const hotspotToRuntime = (hotspot: EditorHotspot): HotspotDefinition => ({
  id: hotspot.id,
  label: hotspot.label,
  x: hotspot.x,
  y: hotspot.y,
  width: hotspot.width,
  height: hotspot.height,
  kind: hotspot.action,
  message: hotspot.message,
  item: hotspot.item,
  requiresItem: hotspot.requiresItem,
  event: hotspot.event === 'none' ? undefined : hotspot.event,
  grantsFlag: hotspot.grantsFlag,
  once: hotspot.once,
  highlight: { color: hotspot.highlightColor, opacity: hotspot.highlightOpacity },
  visibility: hotspot.visibility,
  revealSeconds: hotspot.revealSeconds,
  shape: hotspot.shapePoints && hotspot.shapePoints.length >= 3 ? { points: hotspot.shapePoints.map((point) => ({ x: point.x, y: point.y })) } : undefined,
  indicator: { x: hotspot.indicator.x, y: hotspot.indicator.y },
  cutsceneMedia: hotspot.cutsceneMedia,
  cutscenePath: hotspot.cutscenePath || undefined,
  cutsceneHoldSeconds: hotspot.cutsceneHoldSeconds,
  cutsceneRepeatCount: hotspot.cutsceneRepeatCount,
  hideoutImage: hotspot.hideoutImage,
  // Som sem arquivo é silêncio: o jogo não põe nada no lugar.
  sound: hotspot.sound || undefined,
  soundVolume: hotspot.soundVolume,
  challenge: hotspot.action === 'challenge' && hotspot.challenge ? challengeToRuntime(hotspot.challenge) : undefined,
  npc: hotspot.action === 'npc' ? hotspot.npcId : undefined,
});

const roomToRuntime = (room: EditorLevel['rooms'][number]): RoomDefinition => ({
  id: room.id,
  name: room.name,
  code: room.code,
  image: room.image,
  description: room.description,
  exits: {},
  hotspots: room.hotspots.map(hotspotToRuntime),
  darknessLevel: room.darknessLevel,
  lights: room.lights?.map((l) => ({ x: l.x, y: l.y, radius: l.radius, intensity: l.intensity, color: l.color, angle: l.angle, shape: l.shape, flicker: l.flicker, aperture: l.aperture })),
  audio: room.audio ? { path: room.audio.path, mode: room.audio.mode, volume: room.audio.volume } : undefined,
  // Mídia sem arquivo é um bloco vazio que o editor ainda está preenchendo.
  media: room.media?.filter((entry) => entry.path).map((entry) => ({
    path: entry.path, kind: entry.kind, x: entry.x, y: entry.y, width: entry.width, height: entry.height,
    opacity: entry.opacity, rotation: entry.rotation, loop: entry.loop, onTop: entry.onTop,
  })),
  view: isFullRoomView(room.view) ? undefined : { ...room.view! },
  npcs: room.npcs?.map((entry) => ({
    npcId: entry.npcId, x: entry.x, y: entry.y, height: entry.height,
    flip: entry.flip, requiresFlag: entry.requiresFlag || undefined,
  })),
});

/**
 * Chave da saída na sala de origem. A direção escolhida no editor é só um nome e dois
 * caminhos da mesma sala podem acabar com o mesmo ("Personalizada" duas vezes, por
 * exemplo). Como a chave é única por sala, o segundo apagava o primeiro e o caminho
 * desaparecia do jogo mesmo continuando desenhado no editor: quando o nome já está
 * ocupado o caminho recebe o próprio id, que nunca repete.
 */
const exitKeyFor = (source: RoomDefinition, connection: EditorLevel['connections'][number]): string => {
  const preferred = connection.direction || connection.id;
  return Object.prototype.hasOwnProperty.call(source.exits, preferred) ? `${preferred}-${connection.id}` : preferred;
};

const applyConnections = (level: EditorLevel, rooms: Record<string, RoomDefinition>): void => {
  level.connections.forEach((connection) => {
    const source = rooms[connection.from];
    const destination = rooms[connection.to];
    if (!source || !destination) return;
    source.exits[exitKeyFor(source, connection)] = {
      to: connection.to,
      label: connection.label,
      requires: connection.requiresFlag,
      requiresItem: connection.requiresItem,
      lockedMessage: connection.lockedMessage,
      buttonX: connection.buttonX,
      buttonY: connection.buttonY,
      arrowRotation: connection.arrowRotation,
    };
    if (connection.bidirectional) {
      destination.exits[`voltar-${connection.id}`] = {
        to: connection.from,
        label: `Voltar para ${source.name}`,
      };
    }
  });
};

/** O mundo de um nível só — usado pelos testes e pelo modo de teste do editor. */
export const levelToWorld = (level: EditorLevel): WorldDefinition => {
  const rooms: Record<string, RoomDefinition> = {};
  level.rooms.forEach((room) => { rooms[room.id] = roomToRuntime(room); });
  applyConnections(level, rooms);
  return { rooms, startRoomId: level.startRoomId, escapeRoomId: level.escapeRoomId };
};

export interface ProjectWorld extends WorldDefinition {
  /** Nome do nível a que cada sala pertence, para a trilha sonora saber onde está. */
  roomLevelName: Record<string, string>;
}

/**
 * O mundo inteiro do projeto: todas as salas de todos os níveis em um único mapa.
 * Assim um caminho pode atravessar de um nível para outro sem recarregar nada —
 * as salas já estão todas aqui, e o nível ativo só decide onde o jogador começa.
 */
export const projectToWorld = (levels: readonly EditorLevel[], activeLevelId: string): ProjectWorld => {
  const rooms: Record<string, RoomDefinition> = {};
  const roomLevelName: Record<string, string> = {};
  levels.forEach((level) => {
    level.rooms.forEach((room) => {
      // Dois níveis podem carregar uma sala com o mesmo id (mapas importados): o
      // primeiro fica com o id e o segundo é ignorado, em vez de sobrescrever.
      if (rooms[room.id]) return;
      rooms[room.id] = roomToRuntime(room);
      roomLevelName[room.id] = level.name;
    });
  });
  levels.forEach((level) => applyConnections(level, rooms));
  const active = levels.find((level) => level.id === activeLevelId) ?? levels[0]!;
  return { rooms, startRoomId: active.startRoomId, escapeRoomId: active.escapeRoomId, roomLevelName };
};

export const itemsToRuntime = (items: EditorItem[]): Record<ItemId, ItemDefinition> => {
  const result: Record<ItemId, ItemDefinition> = {};
  items.forEach((item) => {
    result[item.id] = { name: item.name, icon: item.icon, description: item.description, useText: item.useText, effect: item.effect, effectAmount: item.effectAmount, image: item.image, drawing: item.drawing, value: item.value, batterySeconds: item.batterySeconds };
  });
  return result;
};

export const entitiesToRuntime = (entities: EditorEntity[]): Record<EntityId, EntityDefinition> => {
  const result: Record<EntityId, EntityDefinition> = {};
  entities.forEach((entity) => {
    result[entity.id] = {
      name: entity.name, prompt: entity.prompt, hint: entity.hint,
      encounter: entity.encounter, solution: entity.solution, timeLimit: entity.timeLimit,
      image: entity.image, heartWall: entity.heartWall, jumpscareSeconds: entity.jumpscareSeconds,
      heartHoldSeconds: entity.heartHoldSeconds, heartEscapeSeconds: entity.heartEscapeSeconds, heartPull: entity.heartPull,
      heartJoltEvery: entity.heartJoltEvery, heartEntity: entity.heartEntity,
      attacks: entity.attacks?.map((attack) => ({ ...attack, effects: [...attack.effects] })),
    };
  });
  return result;
};

export const npcsToRuntime = (npcs: EditorNpc[]): Record<NpcId, NpcDefinition> => {
  const result: Record<NpcId, NpcDefinition> = {};
  npcs.forEach((npc) => {
    result[npc.id] = {
      name: npc.name,
      title: npc.title || undefined,
      // Sem arte escolhida o jogo desenha o boneco de teste, em SVG.
      art: npc.art || undefined,
      personality: npc.personality,
      reputation: npc.reputation,
      trades: npc.trades,
      stock: npc.stock.map((entry) => ({ ...entry })),
      voice: npc.voice || undefined,
      balloonWidth: npc.balloonWidth || undefined,
      balloonHeight: npc.balloonHeight || undefined,
      balloonOpacity: npc.balloonOpacity < 1 ? npc.balloonOpacity : undefined,
      lines: npc.lines.map((line) => ({
        id: line.id,
        text: line.text,
        answers: line.answers.map((answer) => ({
          id: answer.id,
          text: answer.text,
          to: answer.to || undefined,
          opensTrade: answer.opensTrade || undefined,
          requiresItem: answer.requiresItem,
          givesItem: answer.givesItem,
          takesItem: answer.takesItem,
          grantsFlag: answer.grantsFlag || undefined,
          requiresFlag: answer.requiresFlag || undefined,
          reputation: answer.reputation || undefined,
        })),
      })),
    };
  });
  return result;
};
