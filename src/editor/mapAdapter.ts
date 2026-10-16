import type { HotspotDefinition, RoomDefinition, WorldDefinition } from '../config/world';
import type { EditorHotspot, EditorLevel } from './types';

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
  grantsFlag: hotspot.action === 'use' ? `editor-open:${hotspot.id}` : undefined,
  once: hotspot.once,
  highlight: { color: hotspot.highlightColor, opacity: hotspot.highlightOpacity },
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
    };
  });
  level.connections.forEach((connection) => {
    const source = rooms[connection.from];
    const destination = rooms[connection.to];
    if (!source || !destination) return;
    source.exits[connection.direction || connection.id] = {
      to: connection.to,
      label: connection.label,
      requiresItem: connection.requiresItem,
      lockedMessage: connection.lockedMessage,
    };
    if (connection.bidirectional) {
      destination.exits[`voltar-${connection.id}`] = {
        to: connection.from,
        label: `Voltar para ${source.name}`,
      };
    }
  });
  return { rooms, startRoomId: level.startRoomId };
};
