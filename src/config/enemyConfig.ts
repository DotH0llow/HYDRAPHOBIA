import type { EnemyId, RoomId, Side } from '../types';

export interface EnemyDefinition {
  id: EnemyId;
  name: string;
  epithet: string;
  route: RoomId[];
  side: Side | null;
  baseMoveInterval: number;
  moveChance: number;
  gateWait: number;
  attackDelay: number;
  cooldown: number;
  color: string;
}

export const ENEMY_CONFIG: Record<EnemyId, EnemyDefinition> = {
  hollowKnight: {
    id: 'hollowKnight', name: 'Cavaleiro Oco', epithet: 'o ferro sem alma',
    route: ['dungeon', 'armory', 'courtyard', 'westCorridor', 'westGate'], side: 'west',
    baseMoveInterval: 14, moveChance: 0.46, gateWait: 3.8, attackDelay: 2.8, cooldown: 10, color: '#aeb7b6',
  },
  veiledWidow: {
    id: 'veiledWidow', name: 'Viúva do Véu', epithet: 'a voz atrás da pedra',
    route: ['chapel', 'courtyard', 'eastCorridor', 'eastGate'], side: 'east',
    baseMoveInterval: 11, moveChance: 0.42, gateWait: 2.9, attackDelay: 2.2, cooldown: 12, color: '#829ac8',
  },
  blindMonk: {
    id: 'blindMonk', name: 'Monge Cego', epithet: 'o oficiante sem olhos',
    route: ['chapel', 'courtyard', 'armory', 'tower'], side: null,
    baseMoveInterval: 15, moveChance: 0.38, gateWait: 0, attackDelay: 4.2, cooldown: 15, color: '#887053',
  },
};
