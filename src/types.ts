export type Screen = 'splash' | 'menu' | 'slots' | 'create' | 'game' | 'settings' | 'gameover' | 'escaped' | 'exit';
export type GameStatus = 'exploring' | 'encounter' | 'paused' | 'gameover' | 'escaped' | 'cutscene' | 'hidden' | 'dialogue' | 'challenge';
export type CutsceneMediaType = 'image' | 'gif' | 'video';
export type Direction = string;
export type RoomId = string;
export type ItemId = string;
export type HotspotId = string;
export type EncounterAction = 'run' | 'hide';
/**
 * Como um encontro é jogado. `choice` é a pergunta de sempre, de duas respostas;
 * `heart` é a caixa torácica, em que o jogador segura o próprio coração no lugar.
 */
export type EncounterKind = 'choice' | 'heart';
export type EntityId = string;
export type NpcId = string;
export type HotspotVisibility = 'visible' | 'hidden' | 'invisible';

export type CharacterGender = 'male' | 'female';
/** Clássico mostra a interface do jogo; imersivo deixa a tela só com a cena. */
export type CharacterMode = 'classic' | 'immersive';
export type CharacterClassId = 'explorador' | 'tecnico' | 'adolescente' | 'cavaleiro';
export type PhobiaId =
  | 'nictofobia' | 'claustrofobia' | 'hemofobia' | 'monofobia'
  | 'talassofobia' | 'escopofobia' | 'automatonofobia' | 'necrofobia'
  | 'fonofobia' | 'mecanofobia' | 'tanatofobia' | 'apeirofobia';

/** Quantidade de campanhas paralelas que o jogador pode manter. */
export const SAVE_SLOT_COUNT = 4;

export interface Stats { health: number; hunger: number; thirst: number; anxiety: number }

export interface InventoryEntry { id: ItemId; quantity: number }

export interface Preferences {
  masterVolume: number;
  musicVolume: number;
  effectsVolume: number;
  /** Volume só das vocalizações do personagem (respiração, fome, sede, gritos). */
  voiceVolume: number;
  jumpscareIntensity: number;
  showHealthBar: boolean;
  /** Barras pretas em cima e embaixo da cena, no enquadramento de cinema. */
  filmMode: boolean;
  /** Fita gasta: chuvisco, linhas e a banda que sobe devagar sobre a cena. */
  vhsMode: boolean;
}

/** As preferências que são um liga/desliga; o resto é número de 0 a 1. */
export type BooleanPreferenceKey = 'showHealthBar' | 'filmMode' | 'vhsMode';

export interface CharacterProfile {
  name: string;
  gender: CharacterGender;
  classId: CharacterClassId;
  phobia: PhobiaId;
  startingItem: ItemId;
  /** Escolhido no último passo da criação e fixo para aquela campanha. */
  mode: CharacterMode;
}

export interface Encounter {
  id: EntityId;
  name: string;
  prompt: string;
  hint: string;
  kind: EncounterKind;
  solution: EncounterAction;
  remaining: number;
  timeLimit: number;
  image: string;
  /** Só em `heart`: a parede colada sobre o canto direito da sala onde o jogador está. */
  heartWall?: string;
  jumpscareDuration?: number;
  /**
   * Só em `heart`: a arte da entidade que aparece na cena, escolhida no editor.
   * Ausente é o caso normal — a cena fica vazia, e só o tórax e o coração estão nela.
   */
  heartEntityImage?: string;
  /** Só em `heart`: o estado da mecânica, que a tela desenha e alimenta. */
  heart?: HeartEncounter;
}

/** O que o encontro do coração guarda; a lógica vive em `systems/heartEncounter`. */
export interface HeartEncounter {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  turnIn: number;
  held: number;
  escaped: number;
  elapsed: number;
  grace: number;
  joltIn: number;
  jolt: number;
  holdSeconds: number;
  escapeSeconds: number;
  pull: number;
  joltEvery: number;
}

/**
 * Uma conversa em andamento. Enquanto ela existe o jogador está protegido: nada o
 * ataca com um NPC falando, e isso não é dito em lugar nenhum da tela.
 */
export interface DialogueState {
  npcId: NpcId;
  lineId: string;
  /** A tela de trocas aberta por cima da conversa. */
  trading: boolean;
  /** O que o jogador está oferecendo e o que está pedindo, por item. */
  offer: InventoryEntry[];
  ask: InventoryEntry[];
  /**
   * A carta destacada na mesa. Ela é o que os botões "Oferecer" e "Retirar" movem —
   * a mesa não tem mais e menos em cada item, tem uma carta na mão e dois botões.
   */
  pick?: { side: 'ask' | 'offer'; id: ItemId };
}

/** Uma fala guardada no histórico da conversa. */
export interface DialogueEntry {
  npcId: NpcId;
  /** Nome de quem falou: o NPC ou o personagem. */
  speaker: string;
  text: string;
  /** Quem falou, para o histórico alinhar os dois lados. */
  side: 'npc' | 'player';
  /** Tempo de jogo, em segundos, em que a fala aconteceu. */
  at: number;
}

/** O que cada NPC guarda entre uma conversa e outra, dentro de uma campanha. */
export interface NpcMemory {
  reputation: number;
  stock: InventoryEntry[];
  /** Já falou com este NPC alguma vez. */
  met: boolean;
}

/** O painel de fios aberto agora. */
export interface WireEnd { label: string; color: string }

export interface WireChallengeState {
  /** Os fios que saem da esquerda, na ordem em que aparecem. */
  wires: Array<{ from: string; color: string }>;
  /** Os conectores da direita, embaralhados. */
  connectors: string[];
  /** A ligação certa: de qual letra para qual número. */
  solution: Record<string, string>;
  /** O que o jogador já ligou e acertou. */
  linked: Record<string, string>;
  /** A letra que o jogador pegou agora, esperando um conector. */
  holding: string | null;
  /** A última ligação errada, para a tela dar o choque e esquecer. */
  shockAt: number;
  mistakes: number;
}

export interface ChallengeState {
  hotspotId: HotspotId;
  kind: 'wires';
  /** A cutscene de abertura, enquanto ela ainda está na tela. */
  intro: CutsceneState | null;
  wires: WireChallengeState;
}

export interface HideoutState {
  hotspotId: HotspotId;
  image?: string;
}

export interface CutsceneState {
  hotspotId: HotspotId;
  mediaType: CutsceneMediaType;
  mediaPath: string;
  holdSeconds: number;
  repeatCount: number;
  elapsed: number;
  loopsCompleted: number;
}

export interface GameSave {
  position: RoomId;
  stats: Stats;
  inventory: InventoryEntry[];
  flags: Record<string, boolean>;
  discovered: RoomId[];
  moveCount: number;
  elapsed: number;
  danger: number;
  roomTime: Record<RoomId, number>;
  /** Segundos que o corte ainda tem de sangrar. */
  bleeding?: number;
  /** Carga da lanterna, de 0 a 1. */
  battery?: number;
  /** Reputação e estoque de cada NPC nesta campanha. */
  npcs?: Record<NpcId, NpcMemory>;
  /** Tudo o que foi dito nas conversas, na ordem. */
  dialogueLog?: DialogueEntry[];
  /** Até quando (em tempo de jogo) o jogador ainda sai ileso depois de uma conversa. */
  shieldUntil?: number;
}

/**
 * Como uma campanha terminou. Fica gravado no registro no lugar do progresso, para
 * o card contar o fim em vez de simplesmente esvaziar.
 */
export interface CampaignEnding {
  kind: 'death' | 'escape';
  /** Sala do fim, guardada pelo nome e pelo id do momento em que aconteceu. */
  room: string;
  roomId: RoomId;
  /** Tempo de jogo acumulado, em segundos. */
  elapsed: number;
}

/** Uma campanha: o personagem criado pelo jogador e o progresso dele. */
export interface SaveSlot {
  character: CharacterProfile;
  game: GameSave | null;
  createdAt: string;
  updatedAt: string;
  /** Presente só depois do fim; um registro em andamento não tem. */
  ending?: CampaignEnding;
}

export interface SaveData {
  version: 3;
  updatedAt: string;
  /** Índice do slot em uso, ou `null` quando o jogador está no menu. */
  activeSlot: number | null;
  /** Sempre `SAVE_SLOT_COUNT` posições; `null` é um slot vazio. */
  slots: Array<SaveSlot | null>;
  preferences: Preferences;
}
