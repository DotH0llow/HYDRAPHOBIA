import type { EntityDefinition, HotspotDefinition, ItemDefinition, RoomDefinition, WorldDefinition } from '../config/world';
import type { EntityId, ItemId } from '../types';
import type { EditorEntity, EditorHotspot, EditorItem, EditorLevel } from './types';

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
  targetRoom: hotspot.targetRoomId,
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
});

export const levelToWorld = (level: EditorLevel): WorldDefinition => {
  const rooms: Record<string, RoomDefinition> = {};
  level.rooms.forEach((room) => {
    rooms[room.id] = {
      id: room.id,
      name: room.name,
      code: room.code,
      image: room.image,
      description: room.description,
      exits: {},
      hotspots: room.hotspots.map(hotspotToRuntime),
      darknessLevel: room.darknessLevel,
      lights: room.lights?.map((l) => ({ x: l.x, y: l.y, radius: l.radius, intensity: l.intensity, color: l.color })),
    };
  });
  level.connections.forEach((connection) => {
    const source = rooms[connection.from];
    const destination = rooms[connection.to];
    if (!source || !destination) return;
    source.exits[connection.direction || connection.id] = {
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
  return { rooms, startRoomId: level.startRoomId, escapeRoomId: level.escapeRoomId };
};

export const itemsToRuntime = (items: EditorItem[]): Record<ItemId, ItemDefinition> => {
  const result: Record<ItemId, ItemDefinition> = {};
  items.forEach((item) => {
    result[item.id] = { name: item.name, icon: item.icon, description: item.description, useText: item.useText, effect: item.effect, effectAmount: item.effectAmount, image: item.image };
  });
  return result;
};

export const entitiesToRuntime = (entities: EditorEntity[]): Record<EntityId, EntityDefinition> => {
  const result: Record<EntityId, EntityDefinition> = {};
  entities.forEach((entity) => {
    result[entity.id] = { name: entity.name, prompt: entity.prompt, hint: entity.hint, solution: entity.solution, timeLimit: entity.timeLimit, image: entity.image, jumpscareSeconds: entity.jumpscareSeconds };
  });
  return result;
};
