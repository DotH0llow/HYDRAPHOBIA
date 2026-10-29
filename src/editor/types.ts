import type { ItemEffect, RoomAudioMode } from '../config/world';
import type { LightShape } from '../systems/lighting';
import type { CutsceneMediaType, EncounterAction, EncounterKind, EntityId, HotspotVisibility, ItemId } from '../types';

/**
 * O que um interagível faz. Mudar de sala não está aqui: o único caminho entre salas
 * é uma conexão, desenhada igual no editor e no jogo (a seta com a etiqueta do lugar).
 */
export type EditorHotspotAction = 'examine' | 'collect' | 'use' | 'event' | 'cutscene' | 'hideout';
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
  /** Nível do destino. Ausente (ou igual ao nível da conexão) significa o mesmo nível. */
  toLevelId?: string;
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

export interface EditorLight {
  id: string;
  x: number;
  y: number;
  radius: number;
  intensity: number;
  color: string;
  /** Rotação do formato em graus (0-359). Não tem efeito no círculo. */
  angle: number;
  shape: LightShape;
  /** Intensidade do piscar: 0 deixa a luz estável. */
  flicker: number;
  /** Quanto do foco fica visível, em graus: 360 é inteiro, 180 é meio foco. */
  aperture: number;
}

export const createLight = (id: string): EditorLight => ({
  id, x: 50, y: 50, radius: 20, intensity: 0.9, color: '#fffbe8', angle: 0, shape: 'circle', flicker: 0, aperture: 360,
});

/**
 * Uma mídia solta sobre a cena: foto, GIF ou vídeo colocado dentro da sala, acima da
 * imagem de fundo e abaixo dos interagíveis. É decoração — nada nela é clicável.
 */
export interface EditorRoomMedia {
  id: string;
  path: string;
  kind: CutsceneMediaType;
  /** Canto superior esquerdo e tamanho, em % da cena, como um interagível. */
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  /** Rotação em graus (0-359). */
  rotation: number;
  /** Vídeo e GIF repetem sem parar; desligado, o vídeo toca uma vez e congela. */
  loop: boolean;
  /** Acima dos interagíveis em vez de atrás deles. */
  onTop: boolean;
}

export const createRoomMedia = (id: string, path = '', kind: CutsceneMediaType = 'image'): EditorRoomMedia => ({
  id, path, kind, x: 30, y: 30, width: 40, height: 40, opacity: 1, rotation: 0, loop: true, onTop: false,
});

/**
 * O pedaço da cena que a janela do jogador mostra nesta sala — o campo de visão.
 * Em % da cena 16:9. A janela inteira (0,0,100,100) é o enquadramento de sempre.
 */
export interface EditorRoomView { x: number; y: number; width: number; height: number }

export const FULL_ROOM_VIEW: Readonly<EditorRoomView> = { x: 0, y: 0, width: 100, height: 100 };

/** Uma janela igual à cena inteira não precisa ser gravada nem enviada ao jogo. */
export const isFullRoomView = (view?: EditorRoomView): boolean =>
  !view || (view.x <= 0.05 && view.y <= 0.05 && view.width >= 99.95 && view.height >= 99.95);

/** Trilha presa a uma sala, configurada no editor. */
export interface EditorRoomAudio {
  path: string;
  mode: RoomAudioMode;
  volume: number;
}

export const ROOM_AUDIO_MODES: ReadonlyArray<{ id: RoomAudioMode; label: string; hint: string }> = [
  { id: 'once', label: 'Tocar apenas uma vez', hint: 'Toca na primeira vez que o jogador entra e nunca mais nesta campanha.' },
  { id: 'loop', label: 'Repetir continuamente', hint: 'Fica em laço enquanto o jogador estiver na sala.' },
  { id: 'every-entry', label: 'Repetir a cada entrada', hint: 'Toca uma vez do começo sempre que o jogador entra na sala.' },
];

export interface EditorRoom {
  id: string;
  name: string;
  code: string;
  description: string;
  image: string;
  position: EditorPosition;
  hotspots: EditorHotspot[];
  darknessLevel?: number;
  lights?: EditorLight[];
  audio?: EditorRoomAudio;
  /** Fotos, GIFs e vídeos colocados sobre a cena desta sala. */
  media?: EditorRoomMedia[];
  /** Campo de visão do jogador nesta sala; ausente significa a cena inteira. */
  view?: EditorRoomView;
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
  /**
   * Como o encontro e jogado. A entidade, a cena e a mecanica sao tres coisas soltas
   * de proposito: a mesma entidade pode aparecer em outra cena, e a mesma mecanica
   * pode servir a outra entidade, sem nada precisar ser desenhado de novo.
   */
  encounter: EncounterKind;
  solution: EncounterAction;
  timeLimit: number;
  image: string;
  /**
   * Só no encontro do coração: a parede colada sobre o canto direito da cena. O
   * encontro acontece sempre na sala em que o jogador está; esta parede vem por cima.
   */
  heartWall?: string;
  jumpscareSeconds?: number;
  heartHoldSeconds?: number;
  heartEscapeSeconds?: number;
  heartPull?: number;
  /** De quantos em quantos segundos, em média, vem o tranco forte. */
  heartJoltEvery?: number;
  /**
   * Qual entidade aparece desenhada na cena do encontro. Vazio ou ausente deixa a cena
   * sem ninguém, que é o padrão: quem monta o nível escolhe se há alguém ali, e o
   * encontro não arrasta ninguém para dentro da cena por conta própria.
   */
  heartEntity?: EntityId;
}

export const ENCOUNTER_KINDS: ReadonlyArray<{ id: EncounterKind; label: string; hint: string }> = [
  { id: 'choice', label: 'Decisao (correr ou esconder)', hint: 'A pergunta de duas respostas, com o tempo correndo.' },
  { id: 'heart', label: 'Segure o medo (caixa toracica)', hint: 'O jogador segura o proprio coracao dentro das costelas enquanto a entidade esta ali.' },
];

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
  '/assets/scenes/lobbyEncounter.jpg',
  '/assets/scenes/lobbyWall.jpg',
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
  props: 'public/assets/props',
} as const;

export const detectMediaType = (path: string): 'image' | 'gif' | 'video' => {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'gif') return 'gif';
  if (['mp4', 'webm', 'ogg', 'mov', 'avi'].includes(ext)) return 'video';
  return 'image';
};

/**
 * Arte dos itens que já vêm com o jogo. Fica separada para que um projeto antigo,
 * salvo antes de as imagens existirem, também receba a arte ao ser carregado.
 */
export const DEFAULT_ITEM_IMAGES: Readonly<Record<string, string>> = {
  accessCard: '/assets/items/accessCard.webp',
  almondWater: '/assets/items/almondWater.webp',
  ration: '/assets/items/ration.webp',
  medkit: '/assets/items/medkit.webp',
};

export const DEFAULT_ITEMS: EditorItem[] = [
  { id: 'accessCard', name: 'Cartão sem nome', icon: '▣', description: 'Um cartão magnético amarelado. A tarja ainda parece intacta.', useText: 'Ele deve abrir algum leitor próximo.', effect: 'none', effectAmount: 0, image: DEFAULT_ITEM_IMAGES.accessCard },
  { id: 'almondWater', name: 'Água de amêndoas', icon: '◒', description: 'Uma garrafa lacrada. O líquido tem um cheiro doce e vagamente familiar.', useText: 'A sede recua. Por enquanto.', effect: 'hydrate', effectAmount: 58, image: DEFAULT_ITEM_IMAGES.almondWater },
  { id: 'ration', name: 'Ração selada', icon: '▰', description: 'Uma barra de emergência dura, mas ainda comestível.', useText: 'Sem gosto. Ainda assim, alimento.', effect: 'feed', effectAmount: 48, image: DEFAULT_ITEM_IMAGES.ration },
  { id: 'fuse', name: 'Fusível industrial', icon: '⌁', description: 'Pesado demais para o tamanho. Os contatos não estão oxidados.', useText: 'Talvez pertença a um painel elétrico.', effect: 'none', effectAmount: 0 },
  { id: 'medkit', name: 'Kit de primeiros socorros', icon: '✚', description: 'Gaze, antisséptico e analgésicos dentro do prazo.', useText: 'Os ferimentos foram tratados.', effect: 'heal', effectAmount: 52, image: DEFAULT_ITEM_IMAGES.medkit },
];

export const DEFAULT_ENTITIES: EditorEntity[] = [
  { id: 'watcher', name: 'O Observador', prompt: 'Uma silhueta bloqueia o corredor. Ela reage a movimento.', hint: 'Talvez seja melhor desaparecer da visão.', encounter: 'choice', solution: 'hide', timeLimit: 5, image: '/assets/entities/watcher.jpg' },
  { id: 'crawler', name: 'O Rastejante', prompt: 'Unhas batem no concreto atrás de você. Está se aproximando.', hint: 'Ficar parado significa ser alcançado.', encounter: 'choice', solution: 'run', timeLimit: 4.2, image: '/assets/entities/crawler.jpg' },
  { id: 'vigia', name: 'O que espera no fim do corredor', prompt: 'O corredor não acaba, e há algo parado onde ele deveria acabar. Não se mexe. Está esperando você respirar.', hint: 'Prenda o medo dentro do peito.', encounter: 'heart', solution: 'hide', timeLimit: 5, image: '/assets/entities/watcher.jpg', heartWall: '/assets/scenes/lobbyWall.jpg', heartHoldSeconds: 9, heartEscapeSeconds: 13.4, heartPull: 54, heartJoltEvery: 2.4 },
];
