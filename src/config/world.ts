import type { CutsceneMediaType, Direction, EncounterAction, EncounterKind, EntityId, HotspotId, HotspotVisibility, InventoryEntry, ItemId, NpcId, RoomId } from '../types';

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

/**
 * Um desafio: a cutscene que abre, o mini-jogo em si e a consequência de vencê-lo.
 * A consequência pode ser um texto, um som, uma imagem — ou as três ao mesmo tempo.
 */
export type ChallengeKind = 'wires';

export interface ChallengeOutcome {
  message?: string;
  sound?: string;
  soundVolume?: number;
  image?: string;
  /** Segundos que a imagem da consequência fica na tela. */
  imageSeconds?: number;
  grantsFlag?: string;
  item?: ItemId;
}

export interface ChallengeDefinition {
  kind: ChallengeKind;
  /** A cutscene que abre o desafio; sem arquivo, o painel entra direto. */
  introPath?: string;
  introMedia?: CutsceneMediaType;
  introSeconds?: number;
  /**
   * Só nos fios: quantos fios o painel tem (3 a 6) e, quando quem monta o nível quis
   * escolher, para onde cada letra vai. Vazio sorteia um painel novo a cada partida.
   */
  wireCount?: number;
  wirePairs?: Array<{ from: string; to: string }>;
  /** Dano de cada ligação errada. */
  shockDamage?: number;
  success?: ChallengeOutcome;
  /** O que acontece quando o jogador desiste do painel. */
  giveUp?: ChallengeOutcome;
}

export interface HotspotDefinition {
  id: HotspotId;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: 'examine' | 'collect' | 'use' | 'event' | 'cutscene' | 'hideout' | 'challenge' | 'npc';
  message: string;
  item?: ItemId;
  requiresItem?: ItemId;
  grantsFlag?: string;
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
  /**
   * Arquivo que soa quando o jogador clica neste interagível, escolhido no editor.
   * Ausente é o silêncio: não existe mais som padrão de clique.
   */
  sound?: string;
  /** Ganho do som do interagível (0 a 1); ausente é cheio. */
  soundVolume?: number;
  /** Só em `challenge`: qual mini-jogo abre e o que ele deixa para trás. */
  challenge?: ChallengeDefinition;
  /** Só em `npc`: com quem o jogador começa a conversar ao clicar aqui. */
  npc?: NpcId;
}

/** Como o NPC recebe quem chega. A personalidade decide a reputação inicial dele. */
export type NpcPersonality = 'acolhedor' | 'cordial' | 'desconfiado' | 'hostil';

export const NPC_PERSONALITIES: ReadonlyArray<{ id: NpcPersonality; label: string; reputation: number; hint: string }> = [
  { id: 'acolhedor', label: 'Acolhedor', reputation: 75, hint: 'Começa gostando de você; cobra barato e paga bem.' },
  { id: 'cordial', label: 'Cordial', reputation: 55, hint: 'Nem amigo nem inimigo: preço de tabela.' },
  { id: 'desconfiado', label: 'Desconfiado', reputation: 32, hint: 'Cobra caro até você provar que vale a pena.' },
  { id: 'hostil', label: 'Hostil', reputation: 12, hint: 'Negocia a contragosto, e o preço mostra isso.' },
];

/** Uma resposta que o jogador pode dar. */
export interface NpcAnswer {
  id: string;
  text: string;
  /** Para qual fala ir. Vazio encerra a conversa. */
  to?: string;
  /** Abre a tela de trocas em vez de seguir para outra fala. */
  opensTrade?: boolean;
  requiresItem?: ItemId;
  givesItem?: ItemId;
  takesItem?: ItemId;
  grantsFlag?: string;
  requiresFlag?: string;
  /** Quanto esta resposta mexe na reputação do NPC (pode ser negativo). */
  reputation?: number;
}

export interface NpcLine {
  id: string;
  text: string;
  answers: NpcAnswer[];
}

export interface NpcDefinition {
  name: string;
  /** A linha pequena acima do nome, no balão: ofício, cargo, o que for. */
  title?: string;
  /**
   * A arte do NPC. Vazio deixa o boneco de teste em SVG, que é desenhado pelo jogo e
   * serve para montar a cena antes de a arte de verdade existir.
   */
  art?: string;
  personality: NpcPersonality;
  /** Reputação inicial (0 a 100). Ausente usa a da personalidade. */
  reputation?: number;
  trades: boolean;
  /** O que ele carrega para trocar. */
  stock: InventoryEntry[];
  lines: NpcLine[];
  /** Som curto a cada fala dele. */
  voice?: string;
}

/** Onde um NPC está plantado dentro de uma cena, em % dela. */
export interface RoomNpc {
  npcId: NpcId;
  x: number;
  y: number;
  /** Altura do boneco em % da cena; a largura vem da proporção da arte. */
  height: number;
  /** Espelhado na horizontal, para ele olhar para o outro lado. */
  flip?: boolean;
  /** Fora da cena até uma bandeira acender. */
  requiresFlag?: string;
}

export interface RoomLight {
  x: number;
  y: number;
  radius: number;
  intensity: number;
  color?: string;
  /** Rotação do formato em graus. Não afeta o círculo. */
  angle?: number;
  /** Formato do foco: círculo, quadrado, retângulo, estrela, pentágono ou triângulo. */
  shape?: string;
  /** Amplitude do piscar: 0 mantém a luz estável, 1 apaga por completo nos vales. */
  flicker?: number;
  /** Quanto do foco fica visível, em graus: 360 é inteiro, 180 é meio foco. */
  aperture?: number;
}

/** Quando a trilha presa a uma sala toca de novo. */
export type RoomAudioMode = 'once' | 'loop' | 'every-entry';

/** Música ou efeito preso a uma sala, disparado quando o jogador entra nela. */
export interface RoomAudio {
  /** Caminho do arquivo dentro de `public`, ex.: `/assets/audio/Music/...`. */
  path: string;
  mode: RoomAudioMode;
  /** Ganho aplicado sobre o volume de música (0 a 1). */
  volume?: number;
}

/** Foto, GIF ou vídeo colocado sobre a cena de uma sala. Decoração, nunca clicável. */
export interface RoomMedia {
  path: string;
  kind: CutsceneMediaType;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity?: number;
  rotation?: number;
  loop?: boolean;
  /** Acima dos interagíveis em vez de atrás deles. */
  onTop?: boolean;
}

/**
 * O pedaço da cena que a janela do jogador mostra nesta sala, em % da cena 16:9.
 * Ausente significa a cena inteira, o enquadramento padrão.
 */
export interface RoomView { x: number; y: number; width: number; height: number }

export interface RoomDefinition {
  id: RoomId;
  name: string;
  code: string;
  image: string;
  description: string;
  exits: Record<Direction, ExitDefinition>;
  hotspots: HotspotDefinition[];
  darknessLevel?: number;
  lights?: RoomLight[];
  audio?: RoomAudio;
  media?: RoomMedia[];
  view?: RoomView;
  /** Quem está nesta sala. */
  npcs?: RoomNpc[];
}

export interface WorldDefinition {
  rooms: Record<RoomId, RoomDefinition>;
  npcs?: Record<NpcId, NpcDefinition>;
  startRoomId: RoomId;
  escapeRoomId?: RoomId;
}

/**
 * O que o item faz ao ser usado. `light` é a lanterna: ela não se gasta de uma vez
 * como um curativo, fica acesa consumindo bateria enquanto a cena estiver escura.
 */
export type ItemEffect = 'none' | 'heal' | 'hydrate' | 'feed' | 'light';

export interface ItemDefinition {
  name: string;
  icon: string;
  description: string;
  useText: string;
  effect: ItemEffect;
  effectAmount: number;
  image?: string;
  /**
   * Quanto este item vale na troca. Não existe dinheiro no jogo: o preço de tudo é
   * medido nesta escala, e quem compra entrega itens que somem o valor pedido.
   */
  value?: number;
  /** Só na lanterna: segundos de luz com a bateria cheia. */
  batterySeconds?: number;
}

/** O que um ataque deixa para trás, além do dano. */
export type AttackEffectId = 'bleed' | 'panic' | 'drop';

export const ATTACK_EFFECTS: ReadonlyArray<{ id: AttackEffectId; label: string; hint: string }> = [
  { id: 'bleed', label: 'Ferimento que sangra', hint: 'A vida continua caindo até um curativo fechar o corte.' },
  { id: 'panic', label: 'Pânico', hint: 'A ansiedade salta para o começo do nível seguinte.' },
  { id: 'drop', label: 'Derruba o que está na mão', hint: 'O item selecionado cai e sai do inventário.' },
];

/**
 * Um golpe de uma entidade. Cada monstro tem a própria lista; quando ela está vazia,
 * o golpe é o de sempre — 34 de dano e nada mais.
 */
export interface AttackDefinition {
  id: string;
  name: string;
  damage: number;
  effects: AttackEffectId[];
  /** Só com `bleed`: por quantos segundos o corte continua sangrando. */
  bleedSeconds?: number;
  /** Peso no sorteio entre os golpes da entidade. */
  weight?: number;
}

/** O golpe de fábrica, usado por toda entidade que não tem lista de ataques. */
export const DEFAULT_ATTACK: AttackDefinition = { id: 'golpe', name: 'Golpe', damage: 34, effects: [], weight: 1 };

export interface EntityDefinition {
  name: string;
  prompt: string;
  hint: string;
  /** Como o encontro é jogado; ausente é a pergunta de duas respostas de sempre. */
  encounter?: EncounterKind;
  solution: EncounterAction;
  timeLimit: number;
  image: string;
  /**
   * So no encontro do coracao: a parede que cobre o canto direito da cena. O encontro
   * acontece na sala em que o jogador esta, e esta parede e colada sobre ela — e nela
   * que o personagem assustado fica encostado.
   */
  heartWall?: string;
  jumpscareSeconds?: number;
  /** So no encontro do coracao; ausente usa o padrao da mecanica. */
  heartHoldSeconds?: number;
  heartEscapeSeconds?: number;
  heartPull?: number;
  heartJoltEvery?: number;
  /**
   * So no encontro do coracao: qual entidade aparece desenhada na cena. Vazio ou
   * ausente deixa a cena sem ninguem, que e o padrao — a entidade desta cena e uma
   * escolha de quem monta o nivel, nao algo que o encontro traga sozinho.
   */
  heartEntity?: EntityId;
  /** Os golpes desta entidade. Vazio ou ausente usa o golpe de fábrica. */
  attacks?: AttackDefinition[];
}

export const ITEMS: Record<ItemId, ItemDefinition> = {
  accessCard: { name: 'Cartão sem nome', icon: '▣', description: 'Um cartão magnético amarelado. A tarja ainda parece intacta.', useText: 'Ele deve abrir algum leitor próximo.', effect: 'none', effectAmount: 0, image: '/assets/items/accessCard.webp', value: 6 },
  almondWater: { name: 'Água de amêndoas', icon: '◒', description: 'Uma garrafa lacrada. O líquido tem um cheiro doce e vagamente familiar.', useText: 'A sede recua. Por enquanto.', effect: 'hydrate', effectAmount: 58, image: '/assets/items/almondWater.webp', value: 4 },
  ration: { name: 'Ração selada', icon: '▰', description: 'Uma barra de emergência dura, mas ainda comestível.', useText: 'Sem gosto. Ainda assim, alimento.', effect: 'feed', effectAmount: 48, image: '/assets/items/ration.webp', value: 4 },
  fuse: { name: 'Fusível industrial', icon: '⌁', description: 'Pesado demais para o tamanho. Os contatos não estão oxidados.', useText: 'Talvez pertença a um painel elétrico.', effect: 'none', effectAmount: 0, value: 5 },
  medkit: { name: 'Kit de primeiros socorros', icon: '✚', description: 'Gaze, antisséptico e analgésicos dentro do prazo.', useText: 'Os ferimentos foram tratados.', effect: 'heal', effectAmount: 52, image: '/assets/items/medkit.webp', value: 9 },
  lantern: { name: 'Lanterna de mão', icon: '⌾', description: 'Corpo de borracha gasto e uma lente trincada. A pilha ainda tem carga.', useText: 'Ela acende sozinha onde está escuro, e se apaga onde não precisa.', effect: 'light', effectAmount: 0, image: '/assets/items/lantern.webp', value: 12, batterySeconds: 240 },
};

export const ENTITIES: Record<EntityId, EntityDefinition> = {
  watcher: { name: 'O Observador', prompt: 'Uma silhueta bloqueia o corredor. Ela reage a movimento.', hint: 'Talvez seja melhor desaparecer da visão.', solution: 'hide', timeLimit: 5, image: '/assets/entities/watcher.jpg', attacks: [{ id: 'empurrao', name: 'Empurrão', damage: 28, effects: ['panic'], weight: 2 }, { id: 'unhada', name: 'Unhada', damage: 22, effects: ['bleed'], bleedSeconds: 22, weight: 1 }] },
  crawler: { name: 'O Rastejante', prompt: 'Unhas batem no concreto atrás de você. Está se aproximando.', hint: 'Ficar parado significa ser alcançado.', solution: 'run', timeLimit: 4.2, image: '/assets/entities/crawler.jpg', attacks: [{ id: 'mordida', name: 'Mordida', damage: 26, effects: ['bleed'], bleedSeconds: 30, weight: 3 }, { id: 'rasgo', name: 'Rasgo', damage: 34, effects: ['bleed', 'drop'], bleedSeconds: 18, weight: 1 }] },
  vigia: {
    name: 'O que espera no fim do corredor',
    prompt: 'O corredor não acaba, e há algo parado onde ele deveria acabar. Não se mexe. Está esperando você respirar.',
    hint: 'Prenda o medo dentro do peito.',
    encounter: 'heart', solution: 'hide', timeLimit: 5,
    image: '/assets/entities/watcher.jpg',
    heartWall: '/assets/scenes/lobbyWall.jpg',
    heartHoldSeconds: 17, heartEscapeSeconds: 21.4, heartPull: 54, heartJoltEvery: 2.4,
  },
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
      // Sobre a porta vermelha, no ponto de fuga: olhar para lá chama o encontro do
      // coração. Uma vez por campanha — o susto não sobrevive a ser repetido.
      { id: 'corridorEnd', label: 'Olhar o fim do corredor', x: 31, y: 35, width: 11, height: 17, kind: 'event', event: 'vigia', message: 'Você força a vista até onde o corredor deveria acabar.', once: true },
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
