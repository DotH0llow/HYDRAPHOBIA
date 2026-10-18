import type { CutsceneMediaType, Direction, EncounterAction, EntityId, HotspotId, HotspotVisibility, ItemId, RoomId } from '../types';

export interface ExitDefinition {
  to: RoomId;
  label: string;
  requires?: string;
  requiresItem?: ItemId;
  lockedMessage?: string;
  buttonX?: number;
  buttonY?: number;
  arrowRotation?: number;
}

export interface HotspotShape {
  points: Array<{ x: number; y: number }>;
}

export interface HotspotDefinition {
  id: HotspotId;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: 'examine' | 'collect' | 'use' | 'move' | 'event' | 'cutscene' | 'hideout';
  message: string;
  item?: ItemId;
  requiresItem?: ItemId;
  grantsFlag?: string;
  targetRoom?: RoomId;
  event?: EntityId | 'jumpscare';
  highlight?: { color: string; opacity: number };
  once?: boolean;
  visibility?: HotspotVisibility;
  revealSeconds?: number;
  shape?: HotspotShape;
  indicator?: { x: number; y: number };
  cutsceneMedia?: CutsceneMediaType;
  cutscenePath?: string;
  cutsceneHoldSeconds?: number;
  cutsceneRepeatCount?: number;
  hideoutImage?: string;
}

export interface RoomDefinition {
  id: RoomId;
  name: string;
  code: string;
  image: string;
  description: string;
  exits: Record<Direction, ExitDefinition>;
  hotspots: HotspotDefinition[];
}

export interface WorldDefinition {
  rooms: Record<RoomId, RoomDefinition>;
  startRoomId: RoomId;
  escapeRoomId?: RoomId;
}

export type ItemEffect = 'none' | 'heal' | 'hydrate' | 'feed';

export interface ItemDefinition {
  name: string;
  icon: string;
  description: string;
  useText: string;
  effect: ItemEffect;
  effectAmount: number;
  image?: string;
}

export interface EntityDefinition {
  name: string;
  prompt: string;
  hint: string;
  solution: EncounterAction;
  timeLimit: number;
  image: string;
  jumpscareSeconds?: number;
}

export const ITEMS: Record<ItemId, ItemDefinition> = {
  accessCard: { name: 'Cartão sem nome', icon: '▣', description: 'Um cartão magnético amarelado. A tarja ainda parece intacta.', useText: 'Ele deve abrir algum leitor próximo.', effect: 'none', effectAmount: 0 },
  almondWater: { name: 'Água de amêndoas', icon: '◒', description: 'Uma garrafa lacrada. O líquido tem um cheiro doce e vagamente familiar.', useText: 'A sede recua. Por enquanto.', effect: 'hydrate', effectAmount: 58 },
  ration: { name: 'Ração selada', icon: '▰', description: 'Uma barra de emergência dura, mas ainda comestível.', useText: 'Sem gosto. Ainda assim, alimento.', effect: 'feed', effectAmount: 48 },
  fuse: { name: 'Fusível industrial', icon: '⌁', description: 'Pesado demais para o tamanho. Os contatos não estão oxidados.', useText: 'Talvez pertença a um painel elétrico.', effect: 'none', effectAmount: 0 },
  medkit: { name: 'Kit de primeiros socorros', icon: '✚', description: 'Gaze, antisséptico e analgésicos dentro do prazo.', useText: 'Os ferimentos foram tratados.', effect: 'heal', effectAmount: 52 },
};

export const ENTITIES: Record<EntityId, EntityDefinition> = {
  watcher: { name: 'O Observador', prompt: 'Uma silhueta bloqueia o corredor. Ela reage a movimento.', hint: 'Talvez seja melhor desaparecer da visão.', solution: 'hide', timeLimit: 5, image: '/assets/entities/watcher.jpg' },
  crawler: { name: 'O Rastejante', prompt: 'Unhas batem no concreto atrás de você. Está se aproximando.', hint: 'Ficar parado significa ser alcançado.', solution: 'run', timeLimit: 4.2, image: '/assets/entities/crawler.jpg' },
};

export const ROOMS: Record<RoomId, RoomDefinition> = {
  reception: {
    id: 'reception', name: 'Recepção vazia', code: 'NÍVEL 0 — R.01', image: '/assets/scenes/reception.jpg',
    description: 'O zumbido das lâmpadas preenche o lugar onde deveria haver vozes.',
    exits: {
      forward: { to: 'mainCorridor', label: 'Corredor central' },
      left: { to: 'westWing', label: 'Ala oeste' },
    },
    hotspots: [
      { id: 'receptionNote', label: 'Examinar bilhete', x: 49, y: 48, width: 9, height: 9, kind: 'examine', message: '“NÃO SIGA O SOM. AS LUZES MENTEM.” A tinta ainda está úmida.' },
      { id: 'receptionDrawer', label: 'Abrir gaveta', x: 40, y: 39, width: 12, height: 17, kind: 'collect', message: 'Dentro da gaveta há um cartão magnético sem identificação.', item: 'accessCard', once: true },
    ],
  },
  mainCorridor: {
    id: 'mainCorridor', name: 'Corredor interminável', code: 'NÍVEL 0 — C.12', image: '/assets/scenes/corridor.jpg',
    description: 'Cada passo parece alongar o corredor. Uma porta vermelha espera ao fundo.',
    exits: {
      back: { to: 'reception', label: 'Recepção' },
      right: { to: 'floodedRoom', label: 'Sala lateral' },
      forward: { to: 'maintenance', label: 'Porta vermelha', requires: 'maintenanceUnlocked', lockedMessage: 'A porta não cede. O leitor ao lado pisca em vermelho.' },
    },
    hotspots: [
      { id: 'cardReader', label: 'Usar leitor de cartão', x: 46, y: 37, width: 9, height: 24, kind: 'use', message: 'O leitor aceita o cartão. A fechadura pesada recua com um estalo.', requiresItem: 'accessCard', grantsFlag: 'maintenanceUnlocked', once: true },
      { id: 'wallMarks', label: 'Examinar riscos', x: 15, y: 31, width: 15, height: 29, kind: 'examine', message: 'Marcas de unhas contam grupos de sete. A contagem termina abruptamente.' },
    ],
  },
  westWing: {
    id: 'westWing', name: 'Ala oeste', code: 'NÍVEL 0 — W.04', image: '/assets/scenes/reception.jpg',
    description: 'A mesma recepção, vista de outro ângulo. Você tem certeza de que ela não estava aqui antes.',
    exits: {
      back: { to: 'reception', label: 'Voltar à recepção' },
      forward: { to: 'quietMaze', label: 'Passagem escura' },
    },
    hotspots: [
      { id: 'vendingMachine', label: 'Forçar compartimento', x: 8, y: 30, width: 17, height: 39, kind: 'collect', message: 'Atrás de uma placa solta, você encontra uma ração de emergência.', item: 'ration', once: true },
    ],
  },
  quietMaze: {
    id: 'quietMaze', name: 'Galeria muda', code: 'NÍVEL 0 — ??.??', image: '/assets/scenes/corridor.jpg',
    description: 'As lâmpadas continuam acesas, mas o zumbido desapareceu. Isso é pior.',
    exits: {
      back: { to: 'westWing', label: 'Ala oeste' },
      right: { to: 'floodedRoom', label: 'Reflexo azulado' },
    },
    hotspots: [
      { id: 'wallMarks', label: 'Ouvir a parede', x: 65, y: 23, width: 20, height: 45, kind: 'examine', message: 'Algo se move do outro lado, acompanhando sua respiração.' },
    ],
  },
  floodedRoom: {
    id: 'floodedRoom', name: 'Setor alagado', code: 'SUBNÍVEL — H.02', image: '/assets/scenes/flooded.jpg',
    description: 'A água gelada cobre seus tornozelos. Ondas pequenas chegam de um corredor vazio.',
    exits: {
      back: { to: 'mainCorridor', label: 'Corredor central' },
      left: { to: 'quietMaze', label: 'Galeria muda' },
    },
    hotspots: [
      { id: 'waterBottle', label: 'Coletar garrafa', x: 7, y: 76, width: 16, height: 13, kind: 'collect', message: 'A garrafa está lacrada: água de amêndoas.', item: 'almondWater', once: true },
      { id: 'looseFuse', label: 'Retirar fusível', x: 83, y: 31, width: 12, height: 26, kind: 'collect', message: 'Um fusível intacto estava preso atrás da válvula.', item: 'fuse', once: true },
      { id: 'vendingMachine', label: 'Examinar máquina', x: 13, y: 20, width: 17, height: 45, kind: 'examine', message: 'A máquina está ligada, mas todos os produtos viraram o rótulo para a parede.' },
    ],
  },
  maintenance: {
    id: 'maintenance', name: 'Manutenção', code: 'ACESSO TÉCNICO — M.01', image: '/assets/scenes/maintenance.jpg',
    description: 'O concreto pulsa com o ritmo dos geradores. Uma saída de serviço está sem energia.',
    exits: {
      back: { to: 'mainCorridor', label: 'Corredor central' },
      right: { to: 'threshold', label: 'Cortinas de contenção', requires: 'exitPowered', lockedMessage: 'A trava da saída está morta. Falta energia no painel.' },
    },
    hotspots: [
      { id: 'toolbox', label: 'Revistar caixa', x: 2, y: 49, width: 22, height: 26, kind: 'collect', message: 'Sob as ferramentas enferrujadas há um kit médico intacto.', item: 'medkit', once: true },
      { id: 'breaker', label: 'Reparar painel', x: 52, y: 35, width: 12, height: 24, kind: 'use', message: 'O fusível encaixa. As luzes da saída acendem uma a uma.', requiresItem: 'fuse', grantsFlag: 'exitPowered', once: true },
    ],
  },
  threshold: {
    id: 'threshold', name: 'O limiar', code: 'ROTA NÃO CATALOGADA', image: '/assets/scenes/maintenance.jpg',
    description: 'Além das cortinas, uma corrente de ar real toca seu rosto. Talvez seja uma saída.',
    exits: { back: { to: 'maintenance', label: 'Voltar' } },
    hotspots: [],
  },
};

export const DEFAULT_WORLD: WorldDefinition = {
  rooms: ROOMS,
  startRoomId: 'reception',
  escapeRoomId: 'threshold',
};
