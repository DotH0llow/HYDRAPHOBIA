import { DEFAULT_ATTACK, DEFAULT_WORLD, ENTITIES, ITEMS, type AttackDefinition, type ChallengeOutcome, type EntityDefinition, type HotspotDefinition, type ItemDefinition, type NpcDefinition, type NpcLine, type WorldDefinition } from '../config/world';
import { anxietyTier, escalateAnxiety, type AnxietyTier } from './anxiety';
import { createHeart, DEFAULT_HEART_CONFIG, stepHeart, type HeartConfig, type HeartPointer } from '../systems/heartEncounter';
import { addToStock, buyPrice, sellPrice, shiftReputation, startingReputation, stockQuantity, takeFromStock, TRADE_REPUTATION_GAIN } from '../systems/npc';
import { connectWire, createWirePanel, DEFAULT_SHOCK_DAMAGE, wiresSolved } from '../systems/wires';
import type { ChallengeState, CutsceneState, DialogueEntry, DialogueState, Direction, Encounter, EncounterAction, EntityId, GameSave, GameStatus, HideoutState, HotspotId, InventoryEntry, ItemId, NpcId, NpcMemory, RoomId, Stats } from '../types';

export interface ActionResult {
  changed: boolean;
  message: string;
  pickup?: ItemId;
  attack?: boolean;
}

/** O que uma ligação de fio devolveu, para a tela saber o que mostrar e o que tocar. */
export interface WireResult {
  kind: 'none' | 'linked' | 'shock' | 'solved';
  outcome?: ChallengeOutcome;
}

/** Fome e sede caem três vezes mais devagar do que na versão original do jogo. */
const SURVIVAL_SLOWDOWN = 3;
const HUNGER_DRAIN = 0.096 / SURVIVAL_SLOWDOWN;
const THIRST_DRAIN = 0.144 / SURVIVAL_SLOWDOWN;
const HIDDEN_HUNGER_DRAIN = 0.048 / SURVIVAL_SLOWDOWN;
const HIDDEN_THIRST_DRAIN = 0.072 / SURVIVAL_SLOWDOWN;
const MOVE_HUNGER_COST = 0.65 / SURVIVAL_SLOWDOWN;
const MOVE_THIRST_COST = 0.9 / SURVIVAL_SLOWDOWN;

/** Segundos para a ansiedade subir 1 ponto sozinha (o dobro do ritmo anterior). */
const ANXIETY_RISE_SECONDS = 20;
/** Segundos parado na mesma sala para a ansiedade cair 1 ponto. */
const ANXIETY_CALM_SECONDS = 10;
/** Ansiedade somada a cada travessia de sala. */
const ANXIETY_PER_ROOM_CHANGE = 1;

/** Vida que um corte aberto leva por segundo enquanto não for fechado. */
const BLEED_PER_SECOND = 0.85;
/** De quantos em quantos segundos de sangramento a ansiedade sobe 1 ponto. */
const BLEED_ANXIETY_SECONDS = 6;
/** Quanto tempo um ferimento sangra quando o golpe não disse outra coisa. */
const DEFAULT_BLEED_SECONDS = 25;

/**
 * Conversar protege. Enquanto um NPC está falando nada alcança o jogador, e ele ainda
 * sai da conversa com cinco segundos de folga — tempo de dar dois passos antes de o
 * corredor voltar a cobrar. Nada na tela diz isso; é para ser descoberto.
 */
const DIALOGUE_SHIELD_SECONDS = 5;

/** Acima desta escuridão a lanterna acende sozinha; abaixo dela, se apaga. */
const LANTERN_DARKNESS = 0.45;

export class Game {
  status: GameStatus = 'exploring';
  position: RoomId;
  stats: Stats = { health: 100, hunger: 100, thirst: 100, anxiety: 0 };
  danger = 0;
  inventory: InventoryEntry[] = [];
  flags: Record<string, boolean> = {};
  discovered: Set<RoomId>;
  moveCount = 0;
  elapsed = 0;
  encounter: Encounter | null = null;
  /** Onde o ponteiro segura o coração no encontro da caixa torácica. */
  private heartPointer: HeartPointer | null = null;
  selectedItem: ItemId | null = null;
  /** A legenda começa vazia: nada comenta o início nem a retomada da exploração. */
  message = '';
  attackNonce = 0;
  invincible = false;
  roomTime: Record<RoomId, number> = {};
  cutscene: CutsceneState | null = null;
  hideout: HideoutState | null = null;
  /** Conversa em andamento, o painel de fios aberto e o que cada NPC guarda. */
  dialogue: DialogueState | null = null;
  challenge: ChallengeState | null = null;
  npcMemories: Record<NpcId, NpcMemory> = {};
  dialogueLog: DialogueEntry[] = [];
  /** Segundos de corte ainda aberto, e a carga da lanterna de 0 a 1. */
  bleeding = 0;
  battery = 1;
  lanternOn = false;
  /** O último golpe recebido, para a tela contar o que aconteceu. */
  lastAttack: AttackDefinition | null = null;
  /** Até que ponto do relógio de jogo o jogador ainda sai ileso. */
  private shieldUntil = Number.NEGATIVE_INFINITY;
  private bleedAnxietyTimer = 0;
  /** O que o editor escreveu para o desafio aberto agora. */
  private challengeConfig: HotspotDefinition['challenge'] | null = null;

  private roomDwellTimer = 0;
  private dangerTickTimer = 0;
  private anxietyTimer = 0;
  private calmTimer = 0;
  private criticalTimer = 0;
  private wasStarving = false;
  private lastThreatElapsed = Number.NEGATIVE_INFINITY;

  constructor(
    save?: GameSave,
    private readonly random: () => number = Math.random,
    private readonly world: WorldDefinition = DEFAULT_WORLD,
    startRoomId?: RoomId,
    private readonly items: Record<ItemId, ItemDefinition> = ITEMS,
    private readonly entities: Record<EntityId, EntityDefinition> = ENTITIES,
    private readonly npcs: Record<NpcId, NpcDefinition> = {},
  ) {
    const initialRoom = startRoomId && world.rooms[startRoomId] ? startRoomId : world.startRoomId;
    this.position = initialRoom;
    this.discovered = new Set<RoomId>([initialRoom]);
    if (save && world.rooms[save.position]) this.restore(save);
  }

  /** Um dos três níveis de ansiedade: calma (0-35), inquieto (36-79), terror (80-100). */
  get anxietyLevel(): AnxietyTier { return anxietyTier(this.stats.anxiety); }

  /** Houve encontro ou ataque nos últimos 30 segundos de jogo. */
  get recentlyThreatened(): boolean { return this.elapsed - this.lastThreatElapsed <= 30; }

  /** Verdadeiro quando algo está atrás do jogador: perigo alto ou ameaça recente. */
  get pursued(): boolean { return this.danger >= 50 || this.recentlyThreatened; }

  /**
   * Sala comum: nada de entidade, susto, cutscene pendente, escuridão total ou perigo alto.
   * Usada para os sons de alívio ao entrar em um lugar seguro.
   */
  get roomIsOrdinary(): boolean {
    if (this.status !== 'exploring' || this.encounter || this.cutscene) return false;
    if (this.danger >= 40 || this.recentlyThreatened) return false;
    const room = this.room;
    if ((room.darknessLevel ?? 0) > 0.5) return false;
    return !room.hotspots.some((hotspot) => {
      if (hotspot.once && this.flags[`hotspot:${this.position}:${hotspot.id}`]) return false;
      if (hotspot.kind === 'cutscene' && hotspot.cutscenePath) return true;
      return hotspot.kind === 'event' && Boolean(hotspot.event);
    });
  }

  get room() {
    const room = this.world.rooms[this.position];
    if (!room) throw new Error(`Sala inexistente: ${this.position}`);
    return room;
  }

  update(delta: number): void {
    if (this.status === 'paused' || this.status === 'gameover' || this.status === 'escaped' || delta <= 0) return;
    const capped = Math.min(delta, 0.25);

    if (this.status === 'hidden') {
      this.updateHidden(capped);
      return;
    }
    this.elapsed += capped;
    // O corte continua aberto no meio de qualquer coisa: numa conversa, num painel
    // de fios, numa cutscene. É o que faz dele uma condição e não um dano a mais.
    this.updateWound(capped);
    this.updateLantern(capped);
    // O sangramento pode ter levado o último ponto de vida no meio de qualquer coisa.
    if ((this.status as GameStatus) === 'gameover') return;

    if (this.status === 'dialogue') return;
    if (this.status === 'challenge') { this.updateChallenge(capped); return; }

    if (this.status === 'encounter' && this.encounter) {
      // No encontro do coração não há relógio: o que termina a cena é o jogador ter
      // segurado o medo tempo bastante, ou tê-lo deixado escapar.
      if (this.encounter.kind === 'heart') { this.updateHeart(capped); return; }
      this.encounter.remaining = Math.max(0, this.encounter.remaining - capped);
      if (this.encounter.remaining === 0) this.receiveAttack('Você hesitou. A coisa alcançou você.');
      return;
    }

    if (this.status === 'cutscene' && this.cutscene) {
      this.updateCutscene(capped);
      return;
    }

    this.stats.hunger = this.clamp(this.stats.hunger - capped * HUNGER_DRAIN);
    this.stats.thirst = this.clamp(this.stats.thirst - capped * THIRST_DRAIN);
    const starving = this.stats.hunger === 0 || this.stats.thirst === 0;
    if (starving) {
      if (!this.invincible) {
        this.stats.health = this.clamp(this.stats.health - capped * (this.stats.hunger === 0 && this.stats.thirst === 0 ? 1.2 : 0.65));
        if (!this.wasStarving) this.stats.anxiety = this.clamp(this.stats.anxiety + 10);
      }
      if (this.stats.health === 0) this.status = 'gameover';
    }
    this.wasStarving = starving;

    this.updateRoomTimers(capped);
    this.updateAnxiety(capped);
  }

  /**
   * O ferimento que sangra. Ele não é um susto a mais: é um relógio que só para com
   * um curativo. Enquanto corre, leva vida devagar e aperta a ansiedade de tempos em
   * tempos — a pressa de achar o kit é a mecânica inteira.
   */
  private updateWound(delta: number): void {
    if (this.bleeding <= 0) return;
    this.bleeding = Math.max(0, this.bleeding - delta);
    if (this.invincible) return;
    this.stats.health = this.clamp(this.stats.health - delta * BLEED_PER_SECOND);
    this.bleedAnxietyTimer += delta;
    if (this.bleedAnxietyTimer >= BLEED_ANXIETY_SECONDS) {
      this.bleedAnxietyTimer -= BLEED_ANXIETY_SECONDS;
      this.stats.anxiety = this.clamp(this.stats.anxiety + 1);
    }
    if (this.stats.health === 0) this.status = 'gameover';
  }

  /** O item de luz que o jogador carrega, se carregar algum. */
  private lanternItem(): ItemDefinition | null {
    for (const entry of this.inventory) {
      const definition = this.items[entry.id];
      if (definition?.effect === 'light') return definition;
    }
    return null;
  }

  /**
   * A lanterna não tem botão: ela acende onde a cena é escura e se apaga onde não
   * precisa. Quem decide o custo é a sala — ficar no escuro gasta pilha, e a pilha
   * não volta sozinha.
   */
  private updateLantern(delta: number): void {
    const lantern = this.lanternItem();
    if (!lantern) { this.lanternOn = false; return; }
    const dark = (this.room.darknessLevel ?? 0) >= LANTERN_DARKNESS;
    this.lanternOn = dark && this.battery > 0;
    if (!this.lanternOn) return;
    const seconds = Math.max(10, lantern.batterySeconds ?? 240);
    this.battery = Math.max(0, this.battery - delta / seconds);
    if (this.battery === 0) this.lanternOn = false;
  }

  private updateHidden(delta: number): void {
    this.updateWound(delta);
    this.stats.hunger = this.clamp(this.stats.hunger - delta * HIDDEN_HUNGER_DRAIN);
    this.stats.thirst = this.clamp(this.stats.thirst - delta * HIDDEN_THIRST_DRAIN);
    this.stats.anxiety = this.clamp(this.stats.anxiety - delta * 2);
    if (this.stats.hunger === 0 || this.stats.thirst === 0) {
      if (!this.invincible) this.stats.health = this.clamp(this.stats.health - delta * 0.4);
      if (this.stats.health === 0) this.status = 'gameover';
    }
  }

  exitHideout(): void {
    if (this.status !== 'hidden') return;
    this.status = 'exploring';
    this.hideout = null;
    this.message = 'Você sai do esconderijo com cuidado.';
  }

  private updateCutscene(delta: number): void {
    const cutscene = this.cutscene;
    if (!cutscene || cutscene.mediaType === 'video') return;
    cutscene.elapsed += delta;
    if (cutscene.mediaType === 'image') {
      if (cutscene.elapsed >= cutscene.holdSeconds) this.endCutscene();
      return;
    }
    if (cutscene.elapsed >= cutscene.holdSeconds) {
      cutscene.elapsed = 0;
      this.advanceCutsceneLoop();
    }
  }

  advanceCutsceneLoop(): void {
    if (!this.cutscene) return;
    this.cutscene.loopsCompleted += 1;
    if (this.cutscene.loopsCompleted >= this.cutscene.repeatCount) this.endCutscene();
  }

  private endCutscene(): void {
    this.cutscene = null;
    if (this.status === 'cutscene') this.status = 'exploring';
  }

  navigate(direction: Direction): ActionResult {
    if (this.status !== 'exploring') return { changed: false, message: 'Você não consegue se mover agora.' };
    const exit = this.room.exits[direction];
    if (!exit) return { changed: false, message: 'Não há passagem nessa direção.' };
    if (exit.requires && !this.flags[exit.requires]) {
      this.message = exit.lockedMessage ?? 'O caminho está bloqueado.';
      return { changed: false, message: this.message };
    }
    if (exit.requiresItem && !this.hasItem(exit.requiresItem)) {
      this.message = exit.lockedMessage ?? `Você precisa de ${this.items[exit.requiresItem]?.name ?? exit.requiresItem} para seguir.`;
      return { changed: false, message: this.message };
    }

    if (this.roomDwellTimer < 5) this.addDanger(4);
    this.dangerTickTimer = 0;

    this.position = exit.to;
    this.discovered.add(exit.to);
    this.moveCount += 1;
    this.selectedItem = null;
    this.stats.hunger = this.clamp(this.stats.hunger - MOVE_HUNGER_COST);
    this.stats.thirst = this.clamp(this.stats.thirst - MOVE_THIRST_COST);
    this.onRoomChanged();
    this.message = this.room.description;

    if (this.world.escapeRoomId && this.position === this.world.escapeRoomId) {
      this.status = 'escaped';
      return { changed: true, message: 'Uma corrente de ar toca seu rosto. Você encontrou uma saída — ou algo parecido.' };
    }

    this.maybeStartEncounter();
    return { changed: true, message: this.message };
  }

  interact(id: HotspotId): ActionResult {
    if (this.status === 'hidden') {
      if (this.hideout?.hotspotId === id) { this.exitHideout(); return { changed: true, message: this.message }; }
      return { changed: false, message: 'Você está escondido. Saia primeiro.' };
    }
    if (this.status !== 'exploring') return { changed: false, message: 'Agora não.' };
    const hotspot = this.room.hotspots.find((entry) => entry.id === id);
    if (!hotspot) return { changed: false, message: 'Não há nada ali.' };
    const usedFlag = `hotspot:${this.position}:${id}`;
    if (hotspot.once && this.flags[usedFlag]) {
      this.message = 'Você já retirou tudo que havia aqui.';
      return { changed: false, message: this.message };
    }

    const revealKey = `reveal:${this.position}:${id}`;
    if (hotspot.visibility === 'invisible' && !this.flags[revealKey]) {
      this.flags[revealKey] = true;
      this.message = `Você encontrou algo: ${hotspot.label}.`;
      return { changed: true, message: this.message };
    }
    if (hotspot.visibility === 'invisible') this.flags[revealKey] = true;
    /*
     * O objeto que o jogador clicou pode trazer o próprio encontro. Quando traz, a
     * batida de perigo desta interação não pode abrir outro: era isso que fazia um
     * interagível de evento chamar uma entidade sorteada — quase sempre a primeira da
     * lista — em vez da entidade escolhida para ele. O medidor fica cheio e cobra na
     * próxima batida, depois que esta cena passar.
     */
    const ownEncounter = hotspot.kind === 'event' && Boolean(hotspot.event);
    this.addDanger(hotspot.kind === 'examine' ? 2 : 1, !ownEncounter);
    // Sem encontro próprio, o que o perigo abriu tem prioridade: seguir daqui
    // sobrescreveria o status e deixaria a carta da ameaça sem cronômetro na tela.
    if (this.encounter) return { changed: true, message: this.message };

    if (hotspot.kind === 'collect' && hotspot.item) {
      this.addItem(hotspot.item);
      if (hotspot.once) this.flags[usedFlag] = true;
      this.message = hotspot.message;
      return { changed: true, message: this.message, pickup: hotspot.item };
    }

    if (hotspot.kind === 'use') return this.useOnHotspot(hotspot, usedFlag);
    if (hotspot.kind === 'cutscene' && hotspot.cutscenePath) {
      if (hotspot.once) this.flags[usedFlag] = true;
      this.cutscene = {
        hotspotId: id,
        mediaType: hotspot.cutsceneMedia ?? 'image',
        mediaPath: hotspot.cutscenePath,
        holdSeconds: hotspot.cutsceneHoldSeconds ?? 4,
        repeatCount: hotspot.cutsceneRepeatCount ?? 1,
        elapsed: 0,
        loopsCompleted: 0,
      };
      this.status = 'cutscene';
      this.message = hotspot.message;
      return { changed: true, message: this.message };
    }
    if (hotspot.kind === 'hideout') {
      this.hideout = { hotspotId: id, image: hotspot.hideoutImage };
      this.status = 'hidden';
      this.message = hotspot.message || 'Você se esconde e prende a respiração.';
      if (hotspot.once) this.flags[usedFlag] = true;
      this.stats.anxiety = this.clamp(this.stats.anxiety - 5);
      return { changed: true, message: this.message };
    }
    if (hotspot.kind === 'npc' && hotspot.npc) {
      if (hotspot.once) this.flags[usedFlag] = true;
      if (this.startDialogue(hotspot.npc)) return { changed: true, message: hotspot.message };
      this.message = hotspot.message || 'Não há ninguém aqui para conversar.';
      return { changed: false, message: this.message };
    }
    if (hotspot.kind === 'challenge' && hotspot.challenge) {
      if (hotspot.once) this.flags[usedFlag] = true;
      this.startChallenge(hotspot.id, hotspot.challenge);
      this.message = hotspot.message;
      return { changed: true, message: this.message };
    }
    if (hotspot.kind === 'event' && hotspot.event) {
      if (hotspot.once) this.flags[usedFlag] = true;
      if (hotspot.event === 'jumpscare') return this.receiveAttack(hotspot.message || 'Algo surge perto demais para reagir.');
      if (this.entities[hotspot.event]) {
        this.startEncounter(hotspot.event);
        return { changed: true, message: this.message };
      }
      return { changed: false, message: hotspot.message };
    }
    this.message = hotspot.message;
    return { changed: false, message: this.message };
  }

  selectItem(id: ItemId | null): void {
    this.selectedItem = this.selectedItem === id ? null : id;
    if (this.selectedItem) this.message = `${this.items[this.selectedItem]?.name ?? this.selectedItem} selecionado. Clique em um objeto do cenário para usar.`;
  }

  useItem(id: ItemId): ActionResult {
    if (!this.hasItem(id)) return { changed: false, message: 'Esse item não está mais no inventário.' };
    const definition = this.items[id];
    if (!definition) return { changed: false, message: 'Esse item não está mais no inventário.' };
    if (definition.effect === 'none') {
      this.selectedItem = id;
      this.message = definition.useText;
      return { changed: false, message: `${this.message} Item selecionado para uso no cenário.` };
    }

    // A lanterna não se gasta ao ser usada: ela liga sozinha no escuro, e o que o
    // jogador consegue aqui é só olhar quanta pilha ainda sobrou.
    if (definition.effect === 'light') {
      const charge = Math.round(this.battery * 100);
      this.message = charge > 0 ? `${definition.useText} Pilha em ${charge}%.` : 'A pilha acabou. A lente só devolve o seu reflexo.';
      return { changed: false, message: this.message };
    }

    const statKey = definition.effect === 'heal' ? 'health' : definition.effect === 'hydrate' ? 'thirst' : 'hunger';
    this.stats[statKey] = this.clamp(this.stats[statKey] + definition.effectAmount);
    // Curar é também fechar o corte: é isto que dá ao kit um motivo além do número.
    const wasBleeding = definition.effect === 'heal' && this.bleeding > 0;
    if (wasBleeding) { this.bleeding = 0; this.bleedAnxietyTimer = 0; }
    this.removeItem(id);
    this.selectedItem = null;
    this.message = wasBleeding ? `${definition.useText} O sangramento parou.` : definition.useText;
    return { changed: true, message: this.message };
  }

  examineItem(id: ItemId): string {
    this.message = this.items[id]?.description ?? '';
    return this.message;
  }

  discardItem(id: ItemId): ActionResult {
    if (!this.hasItem(id)) return { changed: false, message: 'O item já não está aqui.' };
    this.removeItem(id);
    if (this.selectedItem === id) this.selectedItem = null;
    this.message = `${this.items[id]?.name ?? id} foi deixado para trás.`;
    return { changed: true, message: this.message };
  }

  respondToEncounter(action: EncounterAction): ActionResult {
    if (!this.encounter || this.status !== 'encounter') return { changed: false, message: 'Não há ameaça imediata.' };
    const success = action === this.encounter.solution;
    if (success) {
      this.message = action === 'hide' ? 'Você prende a respiração. A presença passa sem encontrar você.' : 'Você corre sem olhar para trás. Os passos param depois dos seus.';
      this.encounter = null;
      this.status = 'exploring';
      return { changed: true, message: this.message };
    }
    return this.receiveAttack('A escolha foi errada. Algo rasga seu ombro antes de desaparecer.' );
  }

  // --- conversa, troca e desafio ---

  /** Verdadeiro enquanto nada consegue machucar o jogador. Ele nunca fica sabendo. */
  get shielded(): boolean { return this.status === 'dialogue' || this.elapsed < this.shieldUntil; }

  /** O que este NPC guarda nesta campanha; na primeira vez, nasce do que o editor escreveu. */
  npcMemory(id: NpcId): NpcMemory {
    const existing = this.npcMemories[id];
    if (existing) return existing;
    const definition = this.npcs[id];
    const memory: NpcMemory = {
      reputation: definition ? startingReputation(definition) : 50,
      stock: definition ? definition.stock.map((entry) => ({ ...entry })) : [],
      met: false,
    };
    this.npcMemories[id] = memory;
    return memory;
  }

  npcDefinition(id: NpcId): NpcDefinition | undefined { return this.npcs[id]; }

  /** Quem está visível nesta sala agora; um NPC pode esperar uma bandeira para aparecer. */
  get presentNpcs(): Array<{ npcId: NpcId; definition: NpcDefinition }> {
    return (this.room.npcs ?? [])
      .filter((entry) => !entry.requiresFlag || this.flags[entry.requiresFlag])
      .flatMap((entry) => {
        const definition = this.npcs[entry.npcId];
        return definition ? [{ npcId: entry.npcId, definition }] : [];
      });
  }

  /** A fala que está no balão agora. */
  get dialogueLine(): NpcLine | null {
    const dialogue = this.dialogue;
    if (!dialogue) return null;
    return this.npcs[dialogue.npcId]?.lines.find((line) => line.id === dialogue.lineId) ?? null;
  }

  /** As respostas que o jogador pode dar: as que a campanha já destravou. */
  get dialogueAnswers(): NpcLine['answers'] {
    return (this.dialogueLine?.answers ?? []).filter((answer) => !answer.requiresFlag || this.flags[answer.requiresFlag]);
  }

  startDialogue(id: NpcId): boolean {
    if (this.status !== 'exploring') return false;
    const definition = this.npcs[id];
    const first = definition?.lines[0];
    if (!definition || !first) return false;
    const memory = this.npcMemory(id);
    memory.met = true;
    this.dialogue = { npcId: id, lineId: first.id, trading: false, offer: [], ask: [] };
    this.status = 'dialogue';
    this.selectedItem = null;
    this.logLine(id, 'npc', definition.name, first.text);
    return true;
  }

  /**
   * O jogador responde. A resposta pode pedir um item, dar outro, acender uma bandeira
   * e mexer na reputação — e é isso que faz a conversa ser jogo, e não texto.
   */
  answerDialogue(answerId: string): ActionResult {
    const dialogue = this.dialogue;
    const definition = dialogue ? this.npcs[dialogue.npcId] : undefined;
    const answer = this.dialogueAnswers.find((entry) => entry.id === answerId);
    if (!dialogue || !definition || !answer) return { changed: false, message: '' };
    if (answer.requiresItem && !this.hasItem(answer.requiresItem)) {
      this.message = `Você não tem ${this.items[answer.requiresItem]?.name ?? answer.requiresItem}.`;
      return { changed: false, message: this.message };
    }
    const memory = this.npcMemory(dialogue.npcId);
    this.logLine(dialogue.npcId, 'player', 'Você', answer.text);
    if (answer.takesItem) this.removeItem(answer.takesItem);
    if (answer.givesItem) this.addItem(answer.givesItem);
    if (answer.grantsFlag) this.flags[answer.grantsFlag] = true;
    if (answer.reputation) shiftReputation(memory, answer.reputation);
    if (answer.opensTrade && definition.trades) { dialogue.trading = true; return { changed: true, message: '' }; }

    const next = answer.to ? definition.lines.find((line) => line.id === answer.to) : undefined;
    if (!next) { this.endDialogue(); return { changed: true, message: this.message }; }
    dialogue.lineId = next.id;
    this.logLine(dialogue.npcId, 'npc', definition.name, next.text);
    return { changed: true, message: '' };
  }

  /** Sair da conversa deixa cinco segundos de folga atrás de si. */
  endDialogue(): void {
    if (!this.dialogue) return;
    this.dialogue = null;
    this.shieldUntil = this.elapsed + DIALOGUE_SHIELD_SECONDS;
    if (this.status === 'dialogue') this.status = 'exploring';
  }

  openTrade(): void { if (this.dialogue && this.npcs[this.dialogue.npcId]?.trades) this.dialogue.trading = true; }

  closeTrade(): void {
    if (!this.dialogue) return;
    this.dialogue.trading = false;
    this.dialogue.offer = [];
    this.dialogue.ask = [];
  }

  /** Quanto o vendedor cobra por um item dele, com o humor dele e o estado do jogador. */
  askPriceOf(id: ItemId): number {
    const reputation = this.dialogue ? this.npcMemory(this.dialogue.npcId).reputation : 50;
    return buyPrice(this.items[id]?.value ?? 1, reputation, this.stats.anxiety);
  }

  /** Quanto ele paga por um item do jogador. */
  offerPriceOf(id: ItemId): number {
    const reputation = this.dialogue ? this.npcMemory(this.dialogue.npcId).reputation : 50;
    return sellPrice(this.items[id]?.value ?? 1, reputation);
  }

  /** O que o jogador está pedindo, e o que está dando, somados na mesma escala. */
  get tradeTotals(): { ask: number; offer: number } {
    const dialogue = this.dialogue;
    if (!dialogue) return { ask: 0, offer: 0 };
    const ask = dialogue.ask.reduce((sum, entry) => sum + this.askPriceOf(entry.id) * entry.quantity, 0);
    const offer = dialogue.offer.reduce((sum, entry) => sum + this.offerPriceOf(entry.id) * entry.quantity, 0);
    return { ask, offer };
  }

  /** Põe mais uma unidade na pilha de um dos lados, ou tira uma dela. */
  adjustTrade(side: 'ask' | 'offer', id: ItemId, amount: number): void {
    const dialogue = this.dialogue;
    if (!dialogue) return;
    const list = side === 'ask' ? dialogue.ask : dialogue.offer;
    const available = side === 'ask'
      ? stockQuantity(this.npcMemory(dialogue.npcId), id)
      : (this.inventory.find((entry) => entry.id === id)?.quantity ?? 0);
    const entry = list.find((item) => item.id === id);
    const next = Math.max(0, Math.min(available, (entry?.quantity ?? 0) + amount));
    if (next === 0) {
      const filtered = list.filter((item) => item.id !== id);
      if (side === 'ask') dialogue.ask = filtered; else dialogue.offer = filtered;
      return;
    }
    if (entry) entry.quantity = next;
    else list.push({ id, quantity: next });
  }

  /**
   * Fecha a troca. Não há moeda: o que o jogador oferece precisa somar o que ele
   * pede, na escala de valor do próprio jogo. Dar mais do que se pede não troca o
   * excedente por nada: troca por consideração, que é o que move o preço na próxima vez.
   */
  confirmTrade(): ActionResult {
    const dialogue = this.dialogue;
    if (!dialogue) return { changed: false, message: '' };
    const { ask, offer } = this.tradeTotals;
    if (dialogue.ask.length === 0 && dialogue.offer.length === 0) return { changed: false, message: 'Nada foi posto sobre a mesa.' };
    if (offer < ask) {
      this.message = 'Ele balança a cabeça: não é o bastante.';
      return { changed: false, message: this.message };
    }
    const memory = this.npcMemory(dialogue.npcId);
    dialogue.offer.forEach((entry) => {
      for (let count = 0; count < entry.quantity; count += 1) this.removeItem(entry.id);
      addToStock(memory, entry.id, entry.quantity);
    });
    dialogue.ask.forEach((entry) => {
      takeFromStock(memory, entry.id, entry.quantity);
      for (let count = 0; count < entry.quantity; count += 1) this.addItem(entry.id);
    });
    // Quem paga a mais é lembrado: a generosidade é o único caminho rápido de reputação.
    shiftReputation(memory, TRADE_REPUTATION_GAIN + Math.min(4, Math.floor((offer - ask) / 3)));
    dialogue.ask = [];
    dialogue.offer = [];
    this.message = 'A troca está feita.';
    return { changed: true, message: this.message };
  }

  private logLine(npcId: NpcId, side: 'npc' | 'player', speaker: string, text: string): void {
    this.dialogueLog.push({ npcId, side, speaker, text, at: this.elapsed });
    // O histórico é longo de propósito, mas não infinito: o save tem de caber.
    if (this.dialogueLog.length > 240) this.dialogueLog = this.dialogueLog.slice(-240);
  }

  private startChallenge(hotspotId: HotspotId, challenge: NonNullable<HotspotDefinition['challenge']>): void {
    this.challenge = {
      hotspotId,
      kind: challenge.kind,
      intro: challenge.introPath ? {
        hotspotId,
        mediaType: challenge.introMedia ?? 'image',
        mediaPath: challenge.introPath,
        holdSeconds: challenge.introSeconds ?? 3.5,
        repeatCount: 1,
        elapsed: 0,
        loopsCompleted: 0,
      } : null,
      wires: createWirePanel(challenge, this.random),
    };
    this.challengeConfig = challenge;
    this.status = 'challenge';
  }

  /** Carrega alguma fonte de luz; a tela usa isto para mostrar a pilha. */
  get carriesLantern(): boolean { return this.lanternItem() !== null; }

  /**
   * Põe uma imagem na tela por alguns segundos. É a consequência de um desafio, e ela
   * reaproveita a cutscene: a cutscene já sabe segurar uma foto e devolver o jogo.
   */
  showConsequence(path: string, seconds = 3.5): void {
    if (this.status !== 'exploring' || !path) return;
    this.cutscene = {
      hotspotId: 'consequencia', mediaType: 'image', mediaPath: path,
      holdSeconds: Math.max(0.2, seconds), repeatCount: 1, elapsed: 0, loopsCompleted: 0,
    };
    this.status = 'cutscene';
  }

  /** A cutscene de abertura do desafio corre antes do painel; depois ela some. */
  private updateChallenge(delta: number): void {
    const intro = this.challenge?.intro;
    if (!intro || intro.mediaType === 'video') return;
    intro.elapsed += delta;
    if (intro.elapsed >= intro.holdSeconds) this.challenge!.intro = null;
  }

  /** O vídeo de abertura terminou sozinho. */
  endChallengeIntro(): void { if (this.challenge) this.challenge.intro = null; }

  /** O jogador pega a ponta de um fio; pegar outro simplesmente troca o que está na mão. */
  holdWire(from: string): void {
    const wires = this.challenge?.wires;
    if (!wires || wires.linked[from]) return;
    wires.holding = wires.holding === from ? null : from;
  }

  /** Encosta o fio da mão em um conector. Errar dá choque; acertar prende ali. */
  linkWire(connector: string): WireResult {
    const challenge = this.challenge;
    if (!challenge) return { kind: 'none' };
    const result = connectWire(challenge.wires, connector);
    if (result === 'none') return { kind: 'none' };
    if (result === 'shock') {
      const damage = Math.max(0, this.challengeConfig?.shockDamage ?? DEFAULT_SHOCK_DAMAGE);
      if (!this.invincible && !this.shielded) {
        this.stats.health = this.clamp(this.stats.health - damage);
        this.stats.anxiety = this.clamp(this.stats.anxiety + 2);
        if (this.stats.health === 0) { this.closeChallenge(); this.status = 'gameover'; }
      }
      return { kind: 'shock' };
    }
    if (!wiresSolved(challenge.wires)) return { kind: 'linked' };
    const outcome = this.challengeConfig?.success;
    this.applyOutcome(outcome);
    this.closeChallenge();
    return { kind: 'solved', outcome };
  }

  /** Largar o painel no meio não é de graça: a consequência de desistir também é escrita. */
  giveUpChallenge(): ChallengeOutcome | undefined {
    const outcome = this.challengeConfig?.giveUp;
    this.applyOutcome(outcome);
    this.closeChallenge();
    return outcome;
  }

  private applyOutcome(outcome?: ChallengeOutcome): void {
    if (!outcome) return;
    if (outcome.grantsFlag) this.flags[outcome.grantsFlag] = true;
    if (outcome.item) this.addItem(outcome.item);
    if (outcome.message) this.message = outcome.message;
  }

  private closeChallenge(): void {
    this.challenge = null;
    this.challengeConfig = null;
    if (this.status === 'challenge') this.status = 'exploring';
  }

  pause(value?: boolean): void {
    // Esconderijo também não pausa: sair da pausa devolveria o jogador a 'exploring'
    // com o esconderijo ainda aberto, um estado que a tela não sabe desenhar.
    if (this.status === 'gameover' || this.status === 'escaped' || this.status === 'encounter' || this.status === 'cutscene' || this.status === 'hidden' || this.status === 'dialogue' || this.status === 'challenge') return;
    const shouldPause = value ?? this.status !== 'paused';
    this.status = shouldPause ? 'paused' : 'exploring';
  }

  toSave(): GameSave {
    return {
      position: this.position,
      stats: { ...this.stats },
      inventory: this.inventory.map((entry) => ({ ...entry })),
      flags: { ...this.flags },
      discovered: [...this.discovered],
      moveCount: this.moveCount,
      elapsed: this.elapsed,
      danger: this.danger,
      roomTime: { ...this.roomTime },
      bleeding: this.bleeding,
      battery: this.battery,
      npcs: Object.fromEntries(Object.entries(this.npcMemories).map(([id, memory]) => [id, {
        reputation: memory.reputation,
        met: memory.met,
        stock: memory.stock.map((entry) => ({ ...entry })),
      }])),
      dialogueLog: this.dialogueLog.map((entry) => ({ ...entry })),
      shieldUntil: this.shieldUntil,
    };
  }

  /** Item escolhido na tela de criação do personagem. */
  grantStartingItem(id: ItemId): void {
    if (!this.items[id]) return;
    this.addItem(id);
  }

  debugStartEncounter(id: EntityId): void { this.startEncounter(id); }

  debugSetStat(stat: keyof Stats, value: number): void {
    this.stats[stat] = this.clamp(value);
    if (stat !== 'health') return;
    if (this.stats.health <= 0 && this.status !== 'gameover' && this.status !== 'escaped') this.status = 'gameover';
    else if (this.stats.health > 0 && this.status === 'gameover') this.status = 'exploring';
  }

  debugAddItem(id: ItemId): void { this.addItem(id); }

  debugSetDanger(value: number): void { this.danger = this.clamp(value); }

  /** Abre um ferimento à mão, para afinar o quanto um corte custa. */
  debugBleed(seconds: number): void { this.bleeding = Math.max(0, seconds); this.bleedAnxietyTimer = 0; }

  setInvincible(value: boolean): void { this.invincible = value; }

  private updateRoomTimers(delta: number): void {
    this.roomDwellTimer += delta;
    this.roomTime[this.position] = (this.roomTime[this.position] ?? 0) + delta;
    this.dangerTickTimer += delta;
    if (this.dangerTickTimer >= 10) {
      this.dangerTickTimer -= 10;
      this.addDanger(1);
    }
    this.revealDueHotspots();
  }

  private addDanger(amount: number, mayInterrupt = true): void {
    this.danger = this.clamp(this.danger + amount);
    if (this.danger < 100 || this.status !== 'exploring') return;
    // Quem chamou já tem a própria cena para mostrar: o medidor espera a vez dele.
    if (!mayInterrupt) { this.danger = 99; return; }
    this.danger = 0;
    const ids = Object.keys(this.entities);
    if (ids.length > 0) this.startEncounter(ids[Math.min(ids.length - 1, Math.floor(this.random() * ids.length))]!);
  }

  /**
   * Travessia de sala: a ansiedade sobe 1 ponto e a contagem de calma recomeça,
   * porque ela só desce enquanto o jogador fica parado na mesma sala.
   */
  private onRoomChanged(): void {
    this.roomDwellTimer = 0;
    this.calmTimer = 0;
    this.stats.anxiety = this.clamp(this.stats.anxiety + ANXIETY_PER_ROOM_CHANGE);
  }

  private updateAnxiety(delta: number): void {
    this.anxietyTimer += delta;
    if (this.anxietyTimer >= ANXIETY_RISE_SECONDS) {
      this.anxietyTimer -= ANXIETY_RISE_SECONDS;
      this.stats.anxiety = this.clamp(this.stats.anxiety + 1);
    }
    // Ficar parado na mesma sala acalma: 1 ponto a menos a cada 10s de permanência.
    this.calmTimer += delta;
    if (this.calmTimer >= ANXIETY_CALM_SECONDS) {
      this.calmTimer -= ANXIETY_CALM_SECONDS;
      this.stats.anxiety = this.clamp(this.stats.anxiety - 1);
    }
    const critical = this.stats.health <= 25 || this.stats.hunger <= 25 || this.stats.thirst <= 25;
    if (critical) {
      this.criticalTimer += delta;
      if (this.criticalTimer >= 10) {
        this.criticalTimer -= 10;
        this.stats.anxiety = this.clamp(this.stats.anxiety + 1);
      }
    } else this.criticalTimer = 0;
  }

  private revealDueHotspots(): void {
    const total = this.roomTime[this.position] ?? 0;
    this.room.hotspots.forEach((hotspot) => {
      if (hotspot.visibility !== 'hidden') return;
      const flag = `reveal:${this.position}:${hotspot.id}`;
      if (this.flags[flag]) return;
      if (total >= (hotspot.revealSeconds ?? 25)) this.flags[flag] = true;
    });
  }

  private useOnHotspot(hotspot: HotspotDefinition, usedFlag: string): ActionResult {
    if (hotspot.requiresItem && (this.selectedItem !== hotspot.requiresItem || !this.hasItem(hotspot.requiresItem))) {
      this.message = `Isso exige outro item. Selecione algo no inventário primeiro.`;
      return { changed: false, message: this.message };
    }
    if (hotspot.requiresItem === 'fuse') this.removeItem('fuse');
    if (hotspot.grantsFlag) this.flags[hotspot.grantsFlag] = true;
    if (hotspot.once) this.flags[usedFlag] = true;
    this.selectedItem = null;
    this.message = hotspot.message;
    return { changed: true, message: this.message };
  }

  private maybeStartEncounter(): void {
    const ids = Object.keys(this.entities);
    if (ids.length === 0) return;
    if (this.position === 'quietMaze' && !this.flags.quietEncountered) {
      this.flags.quietEncountered = true;
      this.startEncounter(ids.includes('watcher') ? 'watcher' : ids[0]!);
      return;
    }
    if (this.moveCount >= 4 && this.random() < 0.16) {
      const fallback = ids[Math.min(ids.length - 1, Math.floor(this.random() * ids.length))]!;
      this.startEncounter(this.position === 'maintenance' && ids.includes('crawler') ? 'crawler' : fallback);
    }
  }

  private startEncounter(id: EntityId): void {
    const definition = this.entities[id];
    if (!definition) return;
    const kind = definition.encounter === 'heart' ? 'heart' : 'choice';
    // No encontro do coracao a cena nao ganha entidade sozinha: ela so aparece se o
    // nivel escolheu uma, e a arte vem da entidade escolhida, nao desta aqui.
    const companion = kind === 'heart' && definition.heartEntity ? this.entities[definition.heartEntity] : undefined;
    this.encounter = {
      id, name: definition.name, prompt: definition.prompt, hint: definition.hint,
      kind, solution: definition.solution, remaining: definition.timeLimit, timeLimit: definition.timeLimit,
      image: definition.image, heartWall: kind === 'heart' ? definition.heartWall : undefined, jumpscareDuration: definition.jumpscareSeconds,
      heartEntityImage: companion?.image,
      heart: kind === 'heart' ? { ...createHeart(this.random), ...this.heartConfigOf(definition) } : undefined,
    };
    /*
     * O ponteiro nasce em cima do coração, e não onde o mouse estava. Sem isto, quem
     * já estivesse com o mouse parado no meio da tela quando o encontro começava via o
     * coração voar sozinho para dentro do tórax: o susto virava um presente. A partir
     * daqui a tela só soma o quanto o mouse andou, então o jogador começa sempre com a
     * mão onde o coração está — numa borda qualquer, nunca a mesma.
     */
    this.heartPointer = this.encounter.heart ? { x: this.encounter.heart.x, y: this.encounter.heart.y } : null;
    this.status = 'encounter';
    this.lastThreatElapsed = this.elapsed;
    this.message = this.encounter.prompt;
    this.stats.anxiety = this.clamp(this.stats.anxiety + 10);
  }

  /** Os ajustes da mecânica para esta entidade, com o padrão onde ela não disse nada. */
  private heartConfigOf(definition: EntityDefinition): HeartConfig {
    return {
      holdSeconds: definition.heartHoldSeconds ?? DEFAULT_HEART_CONFIG.holdSeconds,
      escapeSeconds: definition.heartEscapeSeconds ?? DEFAULT_HEART_CONFIG.escapeSeconds,
      pull: definition.heartPull ?? DEFAULT_HEART_CONFIG.pull,
      joltEvery: definition.heartJoltEvery ?? DEFAULT_HEART_CONFIG.joltEvery,
    };
  }

  /**
   * Onde o ponteiro do jogador está, em % da cena — é para lá que o coração vai. A
   * tela é quem sabe disso, então ela avisa antes de cada quadro; `null` é o ponteiro
   * ter saído da janela, e aí o coração fica à deriva.
   */
  setHeartPointer(pointer: HeartPointer | null): void { this.heartPointer = pointer; }

  private updateHeart(delta: number): void {
    const encounter = this.encounter;
    const heart = encounter?.heart;
    if (!encounter || !heart) return;
    const config: HeartConfig = {
      holdSeconds: heart.holdSeconds, escapeSeconds: heart.escapeSeconds,
      pull: heart.pull, joltEvery: heart.joltEvery,
    };
    const { state, outcome } = stepHeart(heart, config, delta, this.heartPointer, this.random);
    Object.assign(heart, state);
    // Segurar o medo custa: a ansiedade sobe enquanto ele está do lado de fora.
    if (state.escaped > heart.escaped - delta) this.stats.anxiety = this.clamp(this.stats.anxiety + delta * 4);
    if (outcome === 'held') {
      this.encounter = null;
      this.heartPointer = null;
      this.status = 'exploring';
      this.message = 'O medo volta para dentro do peito. A presença perde o interesse e se afasta.';
      return;
    }
    if (outcome === 'escaped') {
      this.heartPointer = null;
      this.receiveAttack('O medo escapa do peito. A coisa percebe, e alcança você.');
    }
  }

  /**
   * Qual golpe esta entidade dá desta vez. Cada monstro tem a própria lista, sorteada
   * pelo peso de cada golpe; quem não tem lista continua dando o golpe de fábrica.
   */
  private pickAttack(id?: EntityId): AttackDefinition {
    const list = (id ? this.entities[id]?.attacks : undefined)?.filter((attack) => attack.damage >= 0) ?? [];
    if (list.length === 0) return DEFAULT_ATTACK;
    const weightOf = (attack: AttackDefinition): number => Math.max(0.01, attack.weight ?? 1);
    let roll = this.random() * list.reduce((total, attack) => total + weightOf(attack), 0);
    for (const attack of list) {
      roll -= weightOf(attack);
      if (roll <= 0) return attack;
    }
    return list[list.length - 1]!;
  }

  private receiveAttack(message: string): ActionResult {
    const attack = this.pickAttack(this.encounter?.id);
    this.lastAttack = attack;
    // Conversar protege, e a proteção dura um pouco depois da conversa. O golpe
    // acontece na tela do mesmo jeito; o que não acontece é o estrago.
    if (!this.invincible && !this.shielded) {
      this.stats.health = this.clamp(this.stats.health - attack.damage);
      // Levar um ataque joga o personagem para o início do nível de ansiedade seguinte.
      this.stats.anxiety = this.clamp(escalateAnxiety(this.stats.anxiety));
      if (attack.effects.includes('panic')) this.stats.anxiety = this.clamp(escalateAnxiety(this.stats.anxiety));
      if (attack.effects.includes('bleed')) {
        // Um corte novo não se soma ao antigo: fica valendo o que demora mais a fechar.
        this.bleeding = Math.max(this.bleeding, attack.bleedSeconds ?? DEFAULT_BLEED_SECONDS);
      }
      // O que estava na mão cai: quem apanha segurando alguma coisa larga o que segurava.
      if (attack.effects.includes('drop') && this.selectedItem) {
        this.removeItem(this.selectedItem);
        this.selectedItem = null;
      }
    }
    this.attackNonce += 1;
    this.lastThreatElapsed = this.elapsed;
    this.encounter = null;
    this.status = this.stats.health === 0 ? 'gameover' : 'exploring';
    // Com um corte aberto, a legenda conta o que ficou doendo além do golpe em si.
    const bleeding = this.bleeding > 0 && attack.effects.includes('bleed');
    this.message = this.status === 'gameover'
      ? 'Você não consegue mais se levantar.'
      : bleeding ? `${message} O corte não para de sangrar.` : message;
    return { changed: true, message: this.message, attack: true };
  }

  private addItem(id: ItemId): void {
    const entry = this.inventory.find((item) => item.id === id);
    if (entry) entry.quantity += 1;
    else this.inventory.push({ id, quantity: 1 });
  }

  private hasItem(id: ItemId): boolean { return this.inventory.some((item) => item.id === id && item.quantity > 0); }

  private removeItem(id: ItemId): void {
    const entry = this.inventory.find((item) => item.id === id);
    if (!entry) return;
    entry.quantity -= 1;
    if (entry.quantity <= 0) this.inventory = this.inventory.filter((item) => item.id !== id);
  }

  private restore(save: GameSave): void {
    this.position = save.position;
    this.stats = { ...save.stats };
    this.inventory = save.inventory.map((entry) => ({ ...entry }));
    this.flags = { ...save.flags };
    this.discovered = new Set(save.discovered);
    this.moveCount = save.moveCount;
    this.elapsed = save.elapsed;
    this.danger = save.danger ?? 0;
    this.roomTime = { ...(save.roomTime ?? {}) };
    this.bleeding = Math.max(0, save.bleeding ?? 0);
    this.battery = Math.max(0, Math.min(1, save.battery ?? 1));
    this.npcMemories = Object.fromEntries(Object.entries(save.npcs ?? {}).map(([id, memory]) => [id, {
      reputation: Math.max(0, Math.min(100, memory.reputation)),
      met: memory.met === true,
      stock: (memory.stock ?? []).map((entry) => ({ ...entry })),
    }]));
    this.dialogueLog = (save.dialogueLog ?? []).map((entry) => ({ ...entry }));
    // A folga de uma conversa não atravessa o fechar do jogo.
    this.shieldUntil = Number.NEGATIVE_INFINITY;
    this.message = '';
  }

  private clamp(value: number): number { return Math.max(0, Math.min(100, value)); }
}
