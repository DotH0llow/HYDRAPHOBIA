import { DEFAULT_WORLD, ENTITIES, ITEMS, type EntityDefinition, type HotspotDefinition, type ItemDefinition, type WorldDefinition } from '../config/world';
import { anxietyTier, escalateAnxiety, type AnxietyTier } from './anxiety';
import type { CutsceneState, Direction, Encounter, EncounterAction, EntityId, GameSave, GameStatus, HideoutState, HotspotId, InventoryEntry, ItemId, RoomId, Stats } from '../types';

export interface ActionResult {
  changed: boolean;
  message: string;
  pickup?: ItemId;
  attack?: boolean;
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
  selectedItem: ItemId | null = null;
  message = 'Você desperta no carpete úmido. Não há portas atrás de você.';
  attackNonce = 0;
  invincible = false;
  roomTime: Record<RoomId, number> = {};
  cutscene: CutsceneState | null = null;
  hideout: HideoutState | null = null;

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

    if (this.status === 'encounter' && this.encounter) {
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

  private updateHidden(delta: number): void {
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
    this.addDanger(hotspot.kind === 'examine' ? 2 : 1);

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
    if (hotspot.kind === 'move' && hotspot.targetRoom && this.world.rooms[hotspot.targetRoom]) {
      this.position = hotspot.targetRoom;
      this.discovered.add(hotspot.targetRoom);
      this.selectedItem = null;
      this.onRoomChanged();
      if (hotspot.once) this.flags[usedFlag] = true;
      this.message = hotspot.message || this.room.description;
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

    const statKey = definition.effect === 'heal' ? 'health' : definition.effect === 'hydrate' ? 'thirst' : 'hunger';
    this.stats[statKey] = this.clamp(this.stats[statKey] + definition.effectAmount);
    this.removeItem(id);
    this.selectedItem = null;
    this.message = definition.useText;
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

  pause(value?: boolean): void {
    if (this.status === 'gameover' || this.status === 'escaped' || this.status === 'encounter' || this.status === 'cutscene') return;
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

  private addDanger(amount: number): void {
    this.danger = this.clamp(this.danger + amount);
    if (this.danger >= 100 && this.status === 'exploring') {
      this.danger = 0;
      const ids = Object.keys(this.entities);
      if (ids.length > 0) this.startEncounter(ids[Math.min(ids.length - 1, Math.floor(this.random() * ids.length))]!);
    }
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
    this.encounter = { id, name: definition.name, prompt: definition.prompt, hint: definition.hint, solution: definition.solution, remaining: definition.timeLimit, timeLimit: definition.timeLimit, image: definition.image, jumpscareDuration: definition.jumpscareSeconds };
    this.status = 'encounter';
    this.lastThreatElapsed = this.elapsed;
    this.message = this.encounter.prompt;
    this.stats.anxiety = this.clamp(this.stats.anxiety + 10);
  }

  private receiveAttack(message: string): ActionResult {
    if (!this.invincible) {
      this.stats.health = this.clamp(this.stats.health - 34);
      // Levar um ataque joga o personagem para o início do nível de ansiedade seguinte.
      this.stats.anxiety = this.clamp(escalateAnxiety(this.stats.anxiety));
    }
    this.attackNonce += 1;
    this.lastThreatElapsed = this.elapsed;
    this.encounter = null;
    this.status = this.stats.health === 0 ? 'gameover' : 'exploring';
    this.message = this.status === 'gameover' ? 'Você não consegue mais se levantar.' : message;
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
    this.message = `Você retoma a exploração em ${this.world.rooms[this.position]?.name ?? this.position}.`;
  }

  private clamp(value: number): number { return Math.max(0, Math.min(100, value)); }
}
