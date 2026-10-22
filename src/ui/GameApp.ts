import { ITEMS, type ItemDefinition, type RoomDefinition } from '../config/world';
import { allIllustrated, CLASSES, classArtFor, classLabelFor, DEFAULT_CHARACTER, GENDERS, labelOf, MAX_CHARACTER_NAME, MIN_CHARACTER_NAME, MODES, PHOBIAS, sanitizeCharacterName, STARTING_ITEMS } from '../config/character';
import { Game } from '../core/Game';
import { EditorProject } from '../editor/EditorProject';
import { entitiesToRuntime, itemsToRuntime, projectToWorld } from '../editor/mapAdapter';
import { anxietyTier, anxietyTierLabel } from '../core/anxiety';
import { AudioSystem, type Cue } from '../systems/AudioSystem';
import {
  anxietyCategoryFor, categoryLabel, FX_HUNGER, FX_HUNGER_LOW, FX_HURT, FX_LOW_HEALTH, FX_PANIC_ATTACK, FX_SAFE_ROOM, FX_SCREAM, FX_THIRST, FX_THIRST_LOW,
  isLevelZero, MUSIC_LOBBY, MUSIC_MENU,
} from '../systems/audioLibrary';
import { HUNGER_LOW_THRESHOLD, HUNGER_THRESHOLD, THIRST_LOW_THRESHOLD, THIRST_THRESHOLD } from '../config/thresholds';
import { defaultArrowRotation, defaultPathPosition } from '../config/paths';
import { drawRoomLighting, hasFlicker } from '../systems/lighting';
import { labelAnchorOf } from '../systems/hotspots';
import { checkCharacterName } from '../config/nameFilter';
import { legendTimings, SOLO_LEGEND_MS, splitLegend } from '../systems/legends';
import { roomMediaMarkup, sceneFrameStyle } from '../systems/roomView';
import { createSlot, endCampaign, SaveSystem } from '../systems/SaveSystem';
import { SAVE_SLOT_COUNT, type CampaignEnding, type CharacterClassId, type CharacterGender, type CharacterMode, type CharacterProfile, type Direction, type EncounterAction, type HotspotId, type ItemId, type PhobiaId, type Preferences, type RoomId, type SaveData, type SaveSlot, type Screen } from '../types';

type NumericPreferenceKey = Exclude<keyof Preferences, 'showHealthBar'>;
/** Uma pergunta de sim/nao desenhada pelo proprio jogo, com a acao ja escolhida. */
interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  run: () => void;
}
type SlotMode = 'new' | 'continue';
/** Passos da criação do personagem, na ordem em que o jogador os percorre. */
const CREATE_STEPS = ['gender', 'class', 'name', 'phobia', 'item', 'mode'] as const;
type CreateStep = typeof CREATE_STEPS[number];

/**
 * O personagem em construção. Cada escolha nasce vazia de propósito: o jogador tem
 * de escolher uma opção — e só uma — em cada passo antes de poder seguir.
 */
interface CharacterDraft {
  name: string;
  gender: CharacterGender | null;
  classId: CharacterClassId | null;
  phobia: PhobiaId | null;
  startingItem: ItemId | null;
  mode: CharacterMode | null;
}

const emptyDraft = (): CharacterDraft => ({ name: '', gender: null, classId: null, phobia: null, startingItem: null, mode: null });

/** Quanto tempo a caixa do inventário fica à vista depois de uma interação. */
const INVENTORY_HINT_MS = 4000;

const DANGER_CUES: Record<number, Cue[]> = {
  1: ['discomfort'],
  2: ['suspicion-step', 'suspicion-scratch'],
  3: ['threat-step', 'threat-breath'],
  4: ['danger-scrape', 'danger-silence'],
};
/** Chance de um suspiro de alívio ao entrar em uma sala comum. */
const SAFE_ROOM_CHANCE = 0.16;
const DANGER_INTERVALS: Record<number, [number, number]> = {
  1: [9000, 16000],
  2: [7000, 13000],
  3: [5000, 9000],
  4: [3000, 6000],
};

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);

export class GameApp {
  private screen: Screen = 'menu';
  private game: Game | null = null;
  private items: Record<ItemId, ItemDefinition> = ITEMS;
  private readonly saves = new SaveSystem();
  private save: SaveData;
  private readonly audio: AudioSystem;
  private inventoryOpen = false;
  private focusedItem: ItemId | null = null;
  private lastFrame = performance.now();
  private lastPaint = 0;
  private renderedStructure = '';
  private forcePaint = true;
  private jumpscareUntil = 0;
  private jumpscareImage = '/assets/entities/watcher.jpg';
  private seenAttackNonce = 0;
  private devPanelOpen = false;
  private dangerSoundTier = 0;
  private nextDangerSoundAt = 0;
  private levelName = '';
  /** Campanha em uso e como o jogador chegou à tela de registros. */
  private activeSlot: number | null = null;
  private slotMode: SlotMode = 'new';
  private createStep: CreateStep = 'gender';
  private draft: CharacterDraft = emptyDraft();
  /** Modo imersivo: o jogo roda sem nenhuma peça de interface sobre a cena. */
  private immersive = false;
  /** A pausa foi o navegador escondendo a aba, não o jogador: só essa volta sozinha. */
  private autoPaused = false;
  /** Quantas salas o mapa em jogo tem, para o resumo do fim da campanha. */
  private worldRoomCount = 0;
  /** Até quando a caixa do inventário fica visível; ela só aparece por um tempo. */
  private inventoryHintUntil = 0;
  /** A legenda atual: o texto cru que a gerou, os pedaços dela e onde a fila está. */
  private shownMessage = '';
  private legendParts: string[] = [];
  private legendTimes: number[] = [];
  private legendIndex = 0;
  /** Quando o pedaço atual sai da tela. */
  private legendUntil = 0;
  /** Confirmação dentro do jogo; `window.confirm` não aparece em todos os navegadores. */
  private confirm: ConfirmRequest | null = null;
  /** Salas do projeto inteiro, para a miniatura de cada registro na tela de campanhas. */
  private roomImages: Record<RoomId, string> = {};
  private roomLevelNames: Record<RoomId, string> = {};

  constructor(private readonly root: HTMLElement) {
    this.save = this.saves.load();
    this.audio = new AudioSystem(this.save.preferences);
    this.bindEvents();
    this.bindFirstGesture();
  }

  start(): void {
    this.render(true);
    requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    const delta = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.game && this.screen === 'game') {
      this.game.update(delta);
      if (this.game.attackNonce !== this.seenAttackNonce) {
        this.seenAttackNonce = this.game.attackNonce;
        this.triggerJumpscare(this.game.encounter?.jumpscareDuration);
        this.persist();
      }
      // Morrer encerra a campanha como a fuga encerra. Sem isto o registro ficava no
      // instante anterior à morte — morrer de fome devolvia o jogador com a fome em
      // zero, para morrer de novo em menos de um minuto, sempre no mesmo save.
      if (this.game.status === 'gameover' && Date.now() >= this.jumpscareUntil) { this.screen = 'gameover'; this.audio.stopRoomTrack(); this.clearActiveGame('death'); this.forcePaint = true; }
      if (this.game.status === 'escaped') { this.screen = 'escaped'; this.audio.stopRoomTrack(); this.audio.play('escape'); this.clearActiveGame('escape'); this.forcePaint = true; }
      this.updateDangerAmbience();
      this.updateSampleAmbience();
    }
    this.render();
    // Luzes com flickering precisam de um quadro novo mesmo sem mudança de estado.
    if (this.screen === 'game' && this.game && hasFlicker((this.game.room as RoomDefinition).lights)) this.updateDarknessCanvas();
    requestAnimationFrame(this.tick);
  };

  private render(immediate = false): void {
    const now = performance.now();
    if (!immediate && !this.forcePaint && now - this.lastPaint < 100) return;
    this.lastPaint = now;
    const structure = this.structureKey();
    if (this.forcePaint || structure !== this.renderedStructure) {
      this.root.innerHTML = this.template();
      this.renderedStructure = structure;
      this.forcePaint = false;
      this.bindCutsceneVideo();
      if (this.screen === 'game' && this.game) this.updateDarknessCanvas();
    } else if (this.screen === 'game') this.updateReadouts();
  }

  private updateDarknessCanvas(): void {
    const canvas = this.root.querySelector<HTMLCanvasElement>('[data-role="scene-darkness"]');
    if (!canvas || !this.game) return;
    const room = this.game.room as RoomDefinition;
    const width = canvas.offsetWidth || canvas.parentElement?.clientWidth || 800;
    const height = canvas.offsetHeight || canvas.parentElement?.clientHeight || 600;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawRoomLighting(ctx, canvas.width, canvas.height, room.darknessLevel ?? 0, room.lights ?? [], performance.now());
  }

  private structureKey(): string {
    const dialog = this.confirm ? `|confirm:${this.confirm.title}` : '';
    if (this.screen === 'slots') return `slots:${this.slotMode}:${JSON.stringify(this.save.slots)}${dialog}`;
    // O nome digitado fica de fora de propósito: redesenhar a tela a cada letra tirava
    // o foco do campo. O botão "Continuar" é atualizado à mão em handleInput.
    if (this.screen === 'create') {
      const { name: _name, ...rest } = this.draft;
      return `create:${this.createStep}:${JSON.stringify(rest)}${dialog}`;
    }
    this.trackMessage();
    if (this.screen !== 'game' || !this.game) return `${this.screen}:${this.inventoryOpen}:${this.focusedItem ?? ''}:${JSON.stringify(this.save.preferences)}${dialog}`;
    return JSON.stringify({
      screen: this.screen,
      room: this.game.position,
      status: this.game.status,
      encounter: this.game.encounter?.id,
      cutscene: this.game.cutscene?.hotspotId ?? null,
      hideout: this.game.hideout?.hotspotId ?? null,
      inventory: this.game.inventory,
      inventoryOpen: this.inventoryOpen,
      focusedItem: this.focusedItem,
      selectedItem: this.game.selectedItem,
      devPanelOpen: this.devPanelOpen,
      flags: this.game.flags,
      immersive: this.immersive,
      // O índice entra na chave para que duas legendas iguais em sequência redesenhem.
      message: this.messageVisible() ? `${this.legendIndex}:${this.currentLegend()}` : '',
      inventoryHint: this.inventoryHintVisible(),
      showHealthBar: this.save.preferences.showHealthBar,
      anxietyTier: this.game.anxietyLevel,
      jumpscare: Date.now() < this.jumpscareUntil,
      dialog,
    });
  }

  private template(): string {
    switch (this.screen) {
      case 'menu': return this.menuTemplate();
      case 'slots': return this.slotsTemplate();
      case 'create': return this.createTemplate();
      case 'game': return this.gameTemplate();
      case 'settings': return this.settingsTemplate();
      case 'gameover': return this.gameOverTemplate();
      case 'escaped': return this.escapedTemplate();
      case 'exit': return this.exitTemplate();
    }
  }

  private menuTemplate(): string {
    const hasRecord = this.hasAnyRecord();
    const campaignAction = hasRecord
      ? '<button class="primary" data-action="continue"><span>01</span>Continuar</button>'
      : '<button class="primary" data-action="new-game"><span>01</span>Novo jogo</button>';
    return `<main class="menu-screen">
      <img class="menu-bg" src="/assets/scenes/reception.jpg" alt="Corredores amarelos vazios" />
      <div class="analog-noise" aria-hidden="true"></div><div class="menu-shadow" aria-hidden="true"></div>
      <section class="menu-panel">
        <p class="overline">REGISTRO DE EXPLORAÇÃO // 00</p>
        <h1>HYDRAPHOBIA</h1>
        <p class="subtitle">Você não deveria ter atravessado aquela parede.</p>
        <nav class="menu-actions">
          ${campaignAction}
          <button data-action="tutorial"><span>02</span>Tutorial</button>
          <button data-action="achievements"><span>03</span>Conquistas</button>
          <button data-action="settings"><span>04</span>Configurações</button>
          <button data-action="editor"><span>05</span>Editor de salas</button>
          <button data-action="exit"><span>06</span>Sair</button>
        </nav>
        <p class="menu-foot">Use fones de ouvido · Progresso salvo localmente</p>
      </section>
      <div class="status-code">NÍVEL 0<br><b>LOCALIZAÇÃO DESCONHECIDA</b></div>
    </main>`;
  }

  // --- escolha da campanha ---

  private slotsTemplate(): string {
    const continuing = this.slotMode === 'continue';
    return `<main class="slots-screen">
      <img src="/assets/scenes/corridor.jpg" alt="" />
      <div class="settings-shade"></div>
      <section class="slots-panel">
        <small>${continuing ? 'RETOMAR REGISTRO' : 'NOVO REGISTRO'}</small>
        <h1>${continuing ? 'Continuar' : 'Escolha um registro'}</h1>
        <p class="setting-help">${continuing ? 'Selecione a campanha que deseja retomar.' : 'Cada registro guarda uma campanha independente, com o próprio personagem.'}</p>
        <div class="slot-grid">
          ${this.save.slots.map((slot, index) => this.slotCardTemplate(slot, index, continuing)).join('')}
        </div>
        <button class="slots-back" data-action="slots-back"><i aria-hidden="true">&#8592;</i>Voltar</button>
      </section>
      ${this.confirmTemplate()}
    </main>`;
  }

  /** Miniatura do registro: a sala onde o personagem parou — ou onde a campanha acabou. */
  private slotThumb(slot: SaveSlot): string {
    const position = slot.game?.position ?? slot.ending?.roomId;
    return (position && this.roomImages[position]) || '/assets/scenes/corridor.jpg';
  }

  /** A caixa de confirmação do próprio jogo, no lugar de `window.confirm`. */
  private confirmTemplate(): string {
    const request = this.confirm;
    if (!request) return '';
    return `<div class="modal-layer confirm-layer" role="dialog" aria-modal="true" aria-label="${esc(request.title)}">
      <section class="simple-modal">
        <small>CONFIRMAÇÃO</small>
        <h2>${esc(request.title)}</h2>
        <p>${esc(request.message)}</p>
        <button class="${request.danger ? 'danger-button' : 'primary'}" data-action="confirm-accept">${esc(request.confirmLabel)}</button>
        <button data-action="confirm-cancel">Cancelar</button>
      </section>
    </div>`;
  }

  /** Abre a confirmação; a ação só roda se o jogador disser que sim. */
  private askConfirm(request: ConfirmRequest): void {
    this.confirm = request;
    this.audio.play('click');
  }

  private slotCardTemplate(slot: SaveSlot | null, index: number, continuing: boolean): string {
    const number = String(index + 1).padStart(2, '0');
    if (!slot) {
      return `<article class="slot-card empty">
        <small class="slot-tag">REGISTRO ${number}</small>
        <div class="slot-body">
          <div class="slot-thumb placeholder" aria-hidden="true"><span>+</span></div>
          <div class="slot-info">
            <h2>Vazio</h2>
            <p class="slot-empty-note">Nenhuma campanha gravada aqui.</p>
          </div>
        </div>
        <div class="slot-actions">
          ${continuing
            ? '<button class="wide" disabled>Sem progresso</button>'
            : `<button class="primary wide" data-action="slot-create" data-slot="${index}">Criar personagem</button>`}
        </div>
      </article>`;
    }
    const { character } = slot;
    const progress = slot.game;
    const ending = progress ? undefined : slot.ending;
    const rooms = progress?.discovered.length ?? 0;
    return `<article class="slot-card${ending ? ` ended ended-${ending.kind}` : ''}">
      <small class="slot-tag">REGISTRO ${number}${ending ? ' · ENCERRADO' : ''}</small>
      <div class="slot-body">
        <div class="slot-thumb"><img src="${esc(this.slotThumb(slot))}" alt="" /></div>
        <div class="slot-info">
          <h2>${esc(character.name)}</h2>
          <dl class="slot-facts">
            <div><dt>Classe</dt><dd>${esc(classLabelFor(character.classId, character.gender))}</dd></div>
            <div><dt>Gênero</dt><dd>${esc(labelOf(GENDERS, character.gender))}</dd></div>
            <div><dt>Fobia</dt><dd>${esc(labelOf(PHOBIAS, character.phobia))}</dd></div>
            <div><dt>Tempo</dt><dd>${this.formatTime(progress?.elapsed ?? ending?.elapsed ?? 0)}</dd></div>
          </dl>
        </div>
      </div>
      <p class="slot-progress">${progress
        ? `<span><i aria-hidden="true">&#9635;</i>${rooms} ${rooms === 1 ? 'sala descoberta' : 'salas descobertas'}</span><em>·</em><span><i aria-hidden="true">&#9829;</i>vida ${Math.round(progress.stats.health)}%</span>`
        : ending
          ? this.endingNote(ending)
          : '<span>Personagem criado, exploração ainda não iniciada.</span>'}</p>
      <div class="slot-actions">
        ${progress
          ? `<button class="primary wide" data-action="slot-continue" data-slot="${index}">Continuar</button>`
          : '<button class="wide" disabled>Sem jogo salvo</button>'}
        <div class="slot-actions-row">
          <button class="discard" data-action="slot-delete" data-slot="${index}">Apagar</button>
        </div>
      </div>
    </article>`;
  }

  /**
   * A linha que um registro encerrado mostra no lugar do progresso: como a campanha
   * acabou e onde. Sem isso o registro simplesmente esvaziava, como se o personagem
   * nunca tivesse saído do lugar.
   */
  private endingNote(ending: CampaignEnding): string {
    // O tempo já está na ficha, em "Tempo": repeti-lo aqui só encheria a linha. A sala
    // vem depois do ponto, e não como "em <sala>", para o nome dela não precisar
    // concordar com artigo nenhum — "Escapou · O limiar" serve a qualquer nome.
    const what = ending.kind === 'death'
      ? '<span><i aria-hidden="true">&#9760;</i>Morreu</span>'
      : '<span><i aria-hidden="true">&#10022;</i>Escapou</span>';
    return ending.room ? `${what}<em>·</em><span>${esc(ending.room)}</span>` : what;
  }

  // --- criação de personagem ---

  /**
   * A cena da criação não tem caixa nenhuma: o título, os numerais e a etapa ficam no
   * canto superior esquerdo, as opções ocupam a tela toda e só "Voltar" e "Continuar"
   * ficam no meio da base, tudo flutuando sobre o fundo.
   */
  private createTemplate(): string {
    const step = this.createStep;
    const index = CREATE_STEPS.indexOf(step);
    const last = index === CREATE_STEPS.length - 1;
    // Gênero e classe ficam sobre o preto, sem cenário e sem caixa em volta das artes.
    const dark = step === 'gender' || step === 'class' || step === 'name';
    return `<main class="create-screen${dark ? ' on-black' : ''}">
      ${dark ? '' : '<img src="/assets/scenes/reception.jpg" alt="" /><div class="settings-shade"></div>'}
      <section class="create-panel create-step-${step}">
        <div class="create-head">
          <small>CRIAÇÃO DE PERSONAGEM · REGISTRO ${String((this.activeSlot ?? 0) + 1).padStart(2, '0')}</small>
          <h1>${this.createStepTitle(step)}</h1>
          <ol class="create-steps" aria-label="Etapas">
            ${CREATE_STEPS.map((entry, position) => `<li class="${position === index ? 'active' : position < index ? 'done' : ''}" title="${entry}">${String(position + 1).padStart(2, '0')}</li>`).join('')}
          </ol>
          <p class="create-rule">${this.createStepRule(step)}</p>
        </div>
        <div class="create-body">${this.createStepBody(step)}</div>
        <div class="create-nav">
          <button data-action="create-back">${index === 0 ? 'Voltar aos registros' : 'Voltar'}</button>
          <button class="primary" data-action="create-next" ${this.createStepReady(step) ? '' : 'disabled'}>${last ? 'Começar a exploração' : 'Continuar'}</button>
        </div>
      </section>
    </main>`;
  }

  /** Toda pergunta da criação termina em interrogação. */
  private createStepTitle(step: CreateStep): string {
    return {
      gender: 'Quem atravessou a parede?',
      class: 'O que você era antes?',
      name: 'Como se chama?',
      phobia: 'O que te paralisa?',
      item: 'O que trouxe no bolso?',
      mode: 'Como quer atravessar?',
    }[step];
  }

  /** A regra do passo, dita antes de o jogador descobrir o botão desligado. */
  private createStepRule(step: CreateStep): string {
    if (step === 'name') return `De ${MIN_CHARACTER_NAME} a ${MAX_CHARACTER_NAME} letras.`;
    return 'Escolha uma opção — apenas uma.';
  }

  /** Cada passo exige exatamente uma escolha; o nome exige o mínimo de letras. */
  private createStepReady(step: CreateStep): boolean {
    switch (step) {
      case 'gender': return this.draft.gender !== null;
      case 'class': return this.draft.classId !== null;
      case 'phobia': return this.draft.phobia !== null;
      case 'item': return this.draft.startingItem !== null;
      case 'mode': return this.draft.mode !== null;
      case 'name': {
        const name = sanitizeCharacterName(this.draft.name);
        return name.length >= MIN_CHARACTER_NAME && checkCharacterName(name).ok;
      }
    }
  }

  /** O que há de errado com o nome digitado, ou nada quando ele serve. */
  private nameProblem(): string {
    const name = sanitizeCharacterName(this.draft.name);
    if (!name.length) return '';
    if (name.length < MIN_CHARACTER_NAME) return `O nome precisa de pelo menos ${MIN_CHARACTER_NAME} letras.`;
    return checkCharacterName(name).reason ?? '';
  }

  private createStepBody(step: CreateStep): string {
    switch (step) {
      case 'gender': return this.optionGrid(GENDERS, this.draft.gender, 'gender');
      case 'class': return this.optionGrid(this.classOptions(), this.draft.classId, 'classId');
      case 'phobia': return this.optionGrid(PHOBIAS, this.draft.phobia, 'phobia');
      case 'item': return this.startingItemGrid();
      case 'mode': return this.modeGrid();
      case 'name': {
        // O retrato é a arte da classe escolhida: quem está sendo batizado fica à vista.
        const portrait = this.draft.classId ? classArtFor(this.draft.classId, this.draft.gender ?? 'male') : undefined;
        return `<div class="create-name-row">
          <div class="create-name-field">
            <label class="create-name"><span>Nome do personagem</span>
              <input type="text" maxlength="${MAX_CHARACTER_NAME}" value="${esc(this.draft.name)}" data-draft="name" placeholder="${MIN_CHARACTER_NAME} a ${MAX_CHARACTER_NAME} caracteres" /></label>
            <p class="name-warning" role="alert" data-role="name-warning" ${this.nameProblem() ? '' : 'hidden'}>${esc(this.nameProblem())}</p>
          </div>
          ${portrait ? `<div class="create-portrait"><img src="${esc(portrait)}" alt="" /></div>` : ''}
        </div>`;
      }
    }
  }

  /** As classes com a arte e o nome do gênero já escolhido. */
  private classOptions(): ReadonlyArray<{ id: CharacterClassId; label: string; description: string; icon: string; image?: string }> {
    const gender = this.draft.gender ?? 'male';
    return CLASSES.map((option) => ({ ...option, label: classLabelFor(option.id, gender), image: classArtFor(option.id, gender) }));
  }

  private optionGrid<Id extends string>(options: ReadonlyArray<{ id: Id; label: string; description: string; icon: string; image?: string }>, selected: Id | null, field: string): string {
    // Com arte em todas as opções o card vira a própria ilustração, com o texto por cima.
    const illustrated = allIllustrated(options);
    return `<div class="option-grid ${illustrated ? 'illustrated' : ''}" role="radiogroup">${options.map((option) => `
      <button class="option-card ${option.id === selected ? 'selected' : ''}" role="radio" aria-checked="${option.id === selected}" data-action="draft-set" data-field="${field}" data-value="${esc(option.id)}">
        ${illustrated ? `<img class="option-art" src="${esc(option.image!)}" alt="" loading="lazy" />` : ''}
        <i>${esc(option.icon)}</i><b>${esc(option.label)}</b>${option.description ? `<small>${esc(option.description)}</small>` : ''}
      </button>`).join('')}</div>`;
  }

  /**
   * O último passo mostra, em cada opção, um exemplo do que o jogador vai ver: a
   * mesma cena com a interface por cima e sem nada por cima. O exemplo é montado com
   * as peças reais da tela de jogo em miniatura, e não com uma foto guardada, para
   * nunca envelhecer em relação ao jogo.
   */
  private modeGrid(): string {
    return `<div class="option-grid mode-grid" role="radiogroup">${MODES.map((option) => `
      <button class="option-card ${option.id === this.draft.mode ? 'selected' : ''}" role="radio" aria-checked="${option.id === this.draft.mode}" data-action="draft-set" data-field="mode" data-value="${esc(option.id)}">
        ${this.modeShotTemplate(option.id)}
        <i>${esc(option.icon)}</i><b>${esc(option.label)}</b><small>${esc(option.description)}</small>
      </button>`).join('')}</div>`;
  }

  /** A miniatura de exemplo de um modo: a cena, e a interface só no modo clássico. */
  private modeShotTemplate(mode: CharacterMode): string {
    const hud = mode === 'classic';
    const bars: Array<[string, string, number]> = [['anxiety', 'ANSIEDADE', 62], ['thirst', 'SEDE', 74], ['hunger', 'FOME', 48]];
    return `<span class="mode-shot" aria-hidden="true">
      <img src="/assets/scenes/corridor.jpg" alt="" loading="lazy" />
      <i class="mode-shot-hotspot"></i>
      <i class="mode-shot-path">↑</i>
      ${hud ? `<span class="mode-shot-header">
        <span class="mode-shot-room"><em>NÍVEL 0 — 02</em><b>Corredor longo</b></span>
        <span class="mode-shot-bars">${bars.map(([key, label, value]) => `<span class="mode-shot-bar mode-shot-${key}"><em>${label}</em><i><u style="width:${value}%"></u></i></span>`).join('')}</span>
      </span>
      <span class="mode-shot-legend">As lâmpadas zumbem acima de você.</span>
      <span class="mode-shot-inventory">▦ Inventário</span>` : ''}
      <span class="mode-shot-tag">${hud ? 'com interface' : 'só a cena'}</span>
    </span>`;
  }

  private startingItemGrid(): string {
    const offered = STARTING_ITEMS.map((id) => ({ id, item: this.items[id] })).filter((entry) => entry.item);
    const illustrated = offered.length > 0 && offered.every((entry) => Boolean(entry.item!.image));
    return `<div class="option-grid ${illustrated ? 'illustrated' : ''}" role="radiogroup">${offered.map(({ id, item }) => `
      <button class="option-card ${this.draft.startingItem === id ? 'selected' : ''}" role="radio" aria-checked="${this.draft.startingItem === id}" data-action="draft-set" data-field="startingItem" data-value="${esc(id)}">
        ${illustrated ? `<img class="option-art" src="${esc(item!.image!)}" alt="" loading="lazy" />` : ''}
        <i>${!illustrated && item!.image ? `<img src="${esc(item!.image)}" alt="" />` : esc(item!.icon)}</i><b>${esc(item!.name)}</b><small>${esc(item!.description)}</small>
      </button>`).join('')}</div>`;
  }

  private gameTemplate(): string {
    if (!this.game) return '';
    const room = this.game.room;
    const exits = Object.entries(room.exits) as Array<[Direction, NonNullable<typeof room.exits[Direction]>]>;
    const condition = this.conditionClasses();
    // No modo imersivo nada de interface entra na tela: só a cena e o que está nela.
    const hud = !this.immersive;
    return `<main class="game-screen ${condition}${hud ? '' : ' immersive'}">
      <section class="scene" aria-label="${room.name}">
        <div class="scene-frame" style="${sceneFrameStyle((room as RoomDefinition).view)}">
          <img src="${room.image}" alt="${room.description}" />
          ${roomMediaMarkup((room as RoomDefinition).media, false, esc)}
          <canvas class="scene-darkness-canvas" data-role="scene-darkness" aria-hidden="true"></canvas>
          ${this.hotspotMarkup(room)}
          ${roomMediaMarkup((room as RoomDefinition).media, true, esc)}
          <nav class="movement" aria-label="Movimentação">${exits.map(([direction, exit]) => this.movementButton(direction, exit)).join('')}</nav>
        </div>
        <div class="scene-grade"></div><div class="scene-noise"></div>
      </section>
      <div class="blood-overlay" data-blood-level="${this.bloodLevel()}" aria-hidden="true"><i></i><i></i><i></i></div>
      ${hud ? `<header class="game-header">
        <div class="room-id"><small>${room.code}</small><strong>${room.name}</strong></div>
        <div class="survival-bars">
          ${this.statBar('anxiety', 'ANSIEDADE', this.game.stats.anxiety)}
          ${this.statBar('thirst', 'SEDE', this.game.stats.thirst)}
          ${this.statBar('hunger', 'FOME', this.game.stats.hunger)}
          ${this.save.preferences.showHealthBar ? this.statBar('health', 'VIDA', this.game.stats.health) : ''}
        </div>
      </header>` : ''}
      ${hud && this.messageVisible() ? `<div class="message-strip" role="status" style="--legend-life:${this.legendTimes[this.legendIndex] ?? SOLO_LEGEND_MS}ms"><i></i><p>${esc(this.currentLegend())}</p></div>` : ''}
      ${hud && this.inventoryHintVisible() ? `<button class="inventory-button ${this.game.selectedItem ? 'item-selected' : ''}" data-action="inventory"><span>▦</span><b>Inventário</b><small>${this.itemCountLabel()}</small></button>` : ''}
      ${this.inventoryOpen ? this.inventoryTemplate() : ''}
      ${this.game.encounter ? this.encounterTemplate() : ''}
      ${this.game.status === 'cutscene' ? this.cutsceneTemplate() : ''}
      ${this.game.status === 'hidden' ? this.hiddenTemplate() : ''}
      ${this.game.status === 'paused' ? this.pauseTemplate() : ''}
      ${Date.now() < this.jumpscareUntil ? this.jumpscareTemplate() : ''}
      ${this.confirmTemplate()}
      ${this.devToolsTemplate()}
    </main>`;
  }

  private movementButton(direction: Direction, exit: { to: string; label: string; requires?: string; buttonX?: number; buttonY?: number; arrowRotation?: number }): string {
    const locked = exit.requires && !this.game!.flags[exit.requires];
    const fallback = defaultPathPosition(direction);
    const x = exit.buttonX ?? fallback.x;
    const y = exit.buttonY ?? fallback.y;
    const rotation = exit.arrowRotation ?? defaultArrowRotation(direction);
    // A classe `path-marker` é a mesma do editor: o caminho tem uma aparência só.
    return `<button class="path-marker move-btn ${locked ? 'locked' : ''}" data-action="move" data-direction="${direction}" aria-label="${esc(exit.label)}" style="left:${x}%;top:${y}%"><i style="--rotate:${rotation}deg">↑</i><span>${esc(exit.label)}</span></button>`;
  }

  private hotspotMarkup(room: RoomDefinition): string {
    return room.hotspots.map((hotspot) => {
      const onceUsed = hotspot.once && this.game!.flags[`hotspot:${room.id}:${hotspot.id}`];
      if (onceUsed) return '';
      const revealed = Boolean(this.game!.flags[`reveal:${room.id}:${hotspot.id}`]);
      if (hotspot.visibility === 'hidden' && !revealed) return '';
      const clip = hotspot.shape ? `clip-path:polygon(${hotspot.shape.points.map((point) => `${point.x}% ${point.y}%`).join(',')});` : '';
      const invisible = hotspot.visibility === 'invisible' && !revealed;
      const indicator = hotspot.indicator ?? { x: 50, y: 50 };
      const label = labelAnchorOf(hotspot);
      const marker = `<i class="hotspot-marker${invisible ? ' invisible-hotspot' : ''}" style="left:${indicator.x}%;top:${indicator.y}%"></i>`;
      return `<div class="hotspot-group${invisible ? ' hotspot-invisible' : ''}" style="--x:${hotspot.x}%;--y:${hotspot.y}%;--w:${hotspot.width}%;--h:${hotspot.height}%">
        <button class="hotspot-hitbox" data-action="hotspot" data-hotspot="${hotspot.id}" style="${clip}" aria-label="${hotspot.label}"></button>
        ${marker}
        <span class="hotspot-label" style="left:${label.x}%;top:${label.y}%">${hotspot.label}</span>
      </div>`;
    }).join('');
  }

  /**
   * Legenda com prazo. Um texto curto entra inteiro e fica oito segundos; um texto
   * longo vira uma sequência de legendas, cada uma com o tempo do próprio tamanho, e
   * a fila anda sozinha. Guardar o relógio aqui, no desenho, prende o tempo ao que
   * está de fato na tela.
   */
  private trackMessage(): void {
    const message = this.game?.message ?? '';
    const now = Date.now();
    if (message !== this.shownMessage) {
      this.shownMessage = message;
      this.legendParts = splitLegend(message);
      this.legendTimes = legendTimings(this.legendParts);
      this.legendIndex = 0;
      this.legendUntil = this.legendParts.length ? now + this.legendTimes[0]! : 0;
      return;
    }
    // A fila anda sozinha: cada pedaço sai quando o tempo dele acaba e o próximo entra.
    while (this.legendIndex < this.legendParts.length && now >= this.legendUntil) {
      this.legendIndex += 1;
      if (this.legendIndex < this.legendParts.length) this.legendUntil = now + this.legendTimes[this.legendIndex]!;
    }
  }

  private messageVisible(): boolean { return this.legendIndex < this.legendParts.length; }

  /** O pedaço da legenda que está na tela agora. */
  private currentLegend(): string { return this.legendParts[this.legendIndex] ?? ''; }

  private inventoryHintVisible(): boolean { return Date.now() < this.inventoryHintUntil; }

  /** A caixa do inventário aparece só nestes momentos, e por quatro segundos. */
  private showInventoryHint(): void { this.inventoryHintUntil = Date.now() + INVENTORY_HINT_MS; }

  private itemCountLabel(): string {
    const total = this.game?.inventory.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
    return `${total} ${total === 1 ? 'item' : 'itens'}`;
  }

  private statBar(key: string, label: string, value: number): string {
    // Na ansiedade o ruim é o valor alto, e ela aparece pelos três níveis em vez do número.
    if (key === 'anxiety') {
      return `<div class="stat stat-anxiety anx-${anxietyTier(value)}" data-stat="anxiety"><span>${label}</span><b>${anxietyTierLabel(value)}</b><div><i style="width:${value}%"></i></div></div>`;
    }
    const danger = value <= 25 ? 'danger' : value <= 50 ? 'warning' : '';
    return `<div class="stat stat-${key} ${danger}" data-stat="${key}"><span>${label}</span><b aria-hidden="true">${Math.round(value)}</b><div><i style="width:${value}%"></i></div></div>`;
  }

  private inventoryTemplate(): string {
    const game = this.game!;
    const slots = Array.from({ length: 12 }, (_, index) => game.inventory[index]);
    const focus = this.focusedItem ? this.items[this.focusedItem] : null;
    return `<div class="inventory-layer">
      <button class="inventory-dismiss" data-action="inventory" aria-label="Fechar inventário"></button>
      <aside class="inventory-panel">
        <header><div><small>ARQUIVO PESSOAL</small><h2>Inventário</h2></div><button data-action="inventory">×</button></header>
        <div class="inventory-grid">
          ${slots.map((entry, index) => {
            const def = entry ? this.items[entry.id] : undefined;
            return entry && def
              ? `<button class="item-slot ${game.selectedItem === entry.id ? 'selected' : ''} ${this.focusedItem === entry.id ? 'focused' : ''}" data-action="focus-item" data-item="${entry.id}"><span>${def.image ? `<img src="${def.image}" alt="" />` : def.icon}</span><b>${def.name}</b><em title="Quantidade no inventário" aria-label="${entry.quantity} unidade${entry.quantity === 1 ? '' : 's'}">${entry.quantity}</em></button>`
              : `<div class="item-slot empty"><small>${String(index + 1).padStart(2, '0')}</small></div>`;
          }).join('')}
        </div>
        <section class="item-details">
          ${this.itemDetailsTemplate(this.focusedItem, focus)}
        </section>
      </aside>
    </div>`;
  }

  private itemDetailsTemplate(id: ItemId | null, item = id ? this.items[id] : null): string {
    return item && id ? `<div class="item-large">${item.image ? `<img src="${item.image}" alt="${item.name}" />` : item.icon}</div><div><small>ITEM SELECIONADO</small><h3>${item.name}</h3><p>${item.description}</p><div class="item-actions"><button data-action="use-item" data-item="${id}">Usar</button><button data-action="examine-item" data-item="${id}">Examinar</button><button class="discard" data-action="discard-item" data-item="${id}">Descartar</button></div></div>` : '<p class="empty-details">Selecione um item para examinar ou utilizar.</p>';
  }

  private encounterTemplate(): string {
    const encounter = this.game!.encounter!;
    return `<div class="encounter-layer ${encounter.id}">
      <img class="entity-image" src="${encounter.image}" alt="${encounter.name} bloqueando o caminho" />
      <section class="encounter-card">
        <small>AMEAÇA // DECIDA AGORA</small><h2>${encounter.name}</h2>
        <p>${encounter.prompt}</p><em>${encounter.hint}</em>
        <div class="decision-timer"><i style="width:${(encounter.remaining / encounter.timeLimit) * 100}%"></i></div>
        <div class="decision-buttons"><button data-action="encounter" data-choice="run">Correr</button><button data-action="encounter" data-choice="hide">Esconder-se</button></div>
      </section>
    </div>`;
  }

  private cutsceneTemplate(): string {
    const cutscene = this.game!.cutscene;
    if (!cutscene) return '';
    const progress = cutscene.mediaType === 'image'
      ? (cutscene.holdSeconds > 0 ? cutscene.elapsed / cutscene.holdSeconds : 1)
      : (cutscene.repeatCount > 0 ? cutscene.loopsCompleted / cutscene.repeatCount : 1);
    const media = cutscene.mediaType === 'video'
      ? `<video src="${cutscene.mediaPath}" autoplay muted playsinline data-role="cutscene-video"></video>`
      : `<img src="${cutscene.mediaPath}" alt="Cena" />`;
    return `<div class="cutscene-layer" role="dialog" aria-label="Cena"><div class="cutscene-media">${media}</div><div class="cutscene-progress"><i style="width:${Math.min(100, Math.max(0, progress * 100))}%"></i></div></div>`;
  }

  private bindCutsceneVideo(): void {
    const video = this.root.querySelector<HTMLVideoElement>('[data-role="cutscene-video"]');
    if (!video) return;
    video.onended = () => {
      this.game?.advanceCutsceneLoop();
      this.persist();
      this.forcePaint = true;
      this.render(true);
    };
  }

  private pauseTemplate(): string {
    return `<div class="modal-layer" role="dialog" aria-modal="true" aria-label="Jogo pausado">
      <section class="simple-modal">
        <small>REGISTRO PAUSADO</small>
        <h2>Pausa</h2>
        <p>O tempo parou. Respire antes de continuar.</p>
        <button class="primary" data-action="resume">Continuar</button>
        <button data-action="settings">Configurações</button>
        <button data-action="menu">Menu principal</button>
      </section>
    </div>`;
  }

  private hiddenTemplate(): string {
    const hideout = this.game!.hideout;
    const bg = hideout?.image ? `<img src="${hideout.image}" alt="Esconderijo" />` : '';
    return `<div class="hidden-layer">
      ${bg}
      <div class="hidden-overlay">
        <small>ESCONDIDO</small>
        <p>Você prende a respiração. A ansiedade diminui lentamente.</p>
        <button class="primary" data-action="exit-hideout">Sair do esconderijo</button>
      </div>
    </div>`;
  }

  private jumpscareTemplate(): string {
    return `<div class="jumpscare" style="--intensity:${this.save.preferences.jumpscareIntensity}" aria-label="Ataque repentino"><img src="${this.jumpscareImage}" alt="Entidade atacando" /><div class="jump-static"></div></div>`;
  }

  private settingsTemplate(): string {
    const p = this.save.preferences;
    return `<main class="settings-screen"><img src="/assets/scenes/corridor.jpg" alt="" /><div class="settings-shade"></div><section class="settings-panel"><small>CONFIGURAÇÃO DO REGISTRO</small><h1>Configurações</h1>${this.range('masterVolume', 'Volume geral', p.masterVolume)}${this.range('musicVolume', 'Ambiente / música', p.musicVolume)}${this.range('effectsVolume', 'Efeitos sonoros', p.effectsVolume)}${this.range('voiceVolume', 'Vocalização do personagem', p.voiceVolume)}<p class="setting-help">A vocalização reúne a respiração, os suspiros, a fome, a sede e os gritos do próprio personagem.</p><label class="setting-select"><span>Intensidade dos sustos</span><select data-setting="jumpscareIntensity"><option value="0.25" ${p.jumpscareIntensity < .45 ? 'selected' : ''}>Baixa</option><option value="0.6" ${p.jumpscareIntensity >= .45 && p.jumpscareIntensity < .8 ? 'selected' : ''}>Média</option><option value="1" ${p.jumpscareIntensity >= .8 ? 'selected' : ''}>Alta</option></select></label><p class="setting-help">Controla o tremor, o flash, a duração e parte da força sonora do susto. Os controles de volume continuam valendo separadamente.</p><button data-action="fullscreen">${document.fullscreenElement ? 'Sair da tela cheia' : 'Ativar tela cheia'}</button><button class="danger-button" data-action="clear-save">Apagar save local</button><button class="primary" data-action="settings-back">Voltar</button></section>${this.confirmTemplate()}</main>`;
  }

  private devToolsTemplate(): string {
    if (!this.game) return '';
    // Com o painel fechado os medidores continuam à vista, atualizados em tempo real.
    if (!this.devPanelOpen) return `<div class="dev-live"><button class="dev-toggle" data-action="dev-toggle">DEV</button>${this.devMetersTemplate()}</div>`;
    const itemOptions = Object.entries(this.items).map(([id, item]) => `<option value="${id}">${item.name}</option>`).join('');
    return `<aside class="dev-panel"><header><b>DEV cheats</b><button data-action="dev-toggle">×</button></header>
      ${this.devMetersTemplate()}
      ${(['health', 'thirst', 'hunger', 'anxiety'] as const).map((key) => `<label><span>${key}</span><input type="number" min="0" max="100" value="${Math.round(this.game!.stats[key])}" data-dev-stat="${key}" /></label>`).join('')}
      <label><span>perigo</span><input type="number" min="0" max="100" value="${Math.round(this.game.danger)}" data-dev-danger /></label>
      <label class="dev-check"><input type="checkbox" data-dev-invincible ${this.game.invincible ? 'checked' : ''} /><span>Invencibilidade</span></label>
      <label class="dev-check"><input type="checkbox" data-dev-health-bar ${this.save.preferences.showHealthBar ? 'checked' : ''} /><span>Mostrar barra de vida</span></label>
      <div class="dev-add"><select data-dev-item>${itemOptions}</select><button data-action="dev-add-item">Adicionar item</button></div>
      ${this.devVoicesTemplate()}
      ${this.devNowPlayingTemplate()}
    </aside>`;
  }

  /**
   * Um botão por métrica, tocando a mesma vocalização que o estado atual do
   * personagem dispararia no jogo — sem esperar o intervalo nem o cooldown.
   */
  private devVoicesTemplate(): string {
    const metrics: Array<[string, string]> = [
      ['health', 'vida'], ['thirst', 'sede'], ['hunger', 'fome'], ['anxiety', 'ansiedade'], ['danger', 'perigo'],
    ];
    return `<div class="dev-voices">
      <span>Forçar vocalização</span>
      <div>${metrics.map(([metric, label]) => `<button data-action="dev-voice" data-metric="${metric}">${label}</button>`).join('')}</div>
      <small data-role="dev-voice-status">Toca em sequência os arquivos da métrica, um por clique.</small>
    </div>`;
  }

  /** DEV: o que está soando agora, com o nome único de cada categoria e o arquivo. */
  private devNowPlayingTemplate(): string {
    const { music, effect } = this.nowPlayingText();
    return `<div class="dev-now">
      <span>Tocando agora</span>
      <div class="dev-now-row"><small>Música</small><b data-role="dev-now-music">${esc(music)}</b></div>
      <div class="dev-now-row"><small>Último FX</small><b data-role="dev-now-fx">${esc(effect)}</b></div>
    </div>`;
  }

  /** Texto das duas linhas do "tocando agora", igual no desenho e na atualização. */
  private nowPlayingText(): { music: string; effect: string } {
    const playing = this.audio.nowPlaying();
    const room = playing.roomTrack;
    const last = playing.lastEffect;
    return {
      music: room ? `TRILHA DA SALA · ${room.file}` : playing.music ? `${playing.music.label} · ${playing.music.file}` : '—',
      // Depois de doze segundos o som já terminou: o painel volta ao traço.
      effect: last && Date.now() - last.at < 12000 ? `${last.label} · ${last.file}` : '—',
    };
  }

  /** Atualiza a seção "tocando agora" sem redesenhar o painel inteiro. */
  private updateNowPlaying(): void {
    const music = this.root.querySelector<HTMLElement>('[data-role="dev-now-music"]');
    const fx = this.root.querySelector<HTMLElement>('[data-role="dev-now-fx"]');
    if (!music && !fx) return;
    const text = this.nowPlayingText();
    if (music) music.textContent = text.music;
    if (fx) fx.textContent = text.effect;
  }

  /** Medidores sempre visíveis, para acompanhar o personagem sem abrir o painel. */
  private devMetersTemplate(): string {
    const game = this.game!;
    const rows: Array<[string, string, number]> = [
      ['health', 'vida', game.stats.health],
      ['thirst', 'sede', game.stats.thirst],
      ['hunger', 'fome', game.stats.hunger],
      ['anxiety', 'ansiedade', game.stats.anxiety],
      ['danger', 'perigo', game.danger],
    ];
    return `<div class="dev-meters">${rows.map(([key, label, value]) => `
      <div class="dev-meter" data-dev-meter="${key}"><span>${label}</span><b>${Math.round(value)}</b><i><em style="width:${value}%"></em></i></div>`).join('')}</div>`;
  }

  private range(key: NumericPreferenceKey, label: string, value: number): string {
    return `<label class="setting-range"><span>${label}<b>${Math.round(value * 100)}%</b></span><input type="range" min="0" max="1" step="0.05" value="${value}" data-setting="${key}" /></label>`;
  }

  private gameOverTemplate(): string {
    return `<main class="end-screen gameover"><div class="end-noise"></div><section><small>REGISTRO INTERROMPIDO</small><h1>VOCÊ SE PERDEU</h1><p>Os corredores continuam. Sem você.</p><button class="primary" data-action="new-game">Recomeçar</button><button data-action="menu">Menu principal</button></section></main>`;
  }

  private escapedTemplate(): string {
    const time = this.game ? this.formatTime(this.game.elapsed) : '—';
    // O total vem do mapa jogado: o número de salas muda com o projeto do editor.
    const discovered = this.game?.discovered.size ?? 0;
    const total = this.worldRoomCount || discovered;
    return `<main class="end-screen escaped"><img src="/assets/scenes/maintenance.jpg" alt="Saída de manutenção" /><div class="escape-light"></div><section><small>ROTA NÃO CATALOGADA</small><h1>AR DE FORA</h1><p>Você encontrou uma passagem. Atrás de você, as lâmpadas continuam zumbindo.</p><div class="summary"><span>Tempo <b>${time}</b></span><span>Salas descobertas <b>${discovered}/${total}</b></span><span>Vida restante <b>${Math.round(this.game?.stats.health ?? 0)}%</b></span></div><button class="primary" data-action="menu">Encerrar registro</button></section></main>`;
  }

  private exitTemplate(): string {
    return `<main class="exit-screen"><section><small>SESSÃO ENCERRADA</small><h1>O registro foi fechado.</h1><p>Seu navegador não permite que uma página feche a própria aba. Você já pode fechá-la com segurança.</p><button data-action="menu">Retornar ao menu</button></section></main>`;
  }

  private bindEvents(): void {
    this.root.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (!target || target.matches(':disabled')) return;
      void this.audio.unlock();
      void this.handleAction(target.dataset.action ?? '', target.dataset);
    });
    this.root.addEventListener('input', (event) => this.handleInput(event.target as HTMLInputElement));
    this.root.addEventListener('change', (event) => this.handleInput(event.target as HTMLInputElement));
    window.addEventListener('keydown', (event) => this.handleKey(event));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.game?.status === 'exploring') {
        this.autoPaused = true;
        this.game.pause(true);
        void this.audio.pauseGameplay().catch(() => undefined);
      } else if (!document.hidden && this.autoPaused && this.game?.status === 'paused') {
        // Só a pausa automática volta sozinha: a pausa do jogador espera o jogador.
        this.autoPaused = false;
        this.game.pause(false);
        void this.audio.resumeGameplay().catch(() => undefined);
      }
      this.forcePaint = true;
    });
  }

  /** O navegador só libera áudio depois de uma interação; a primeira serve de gatilho. */
  private bindFirstGesture(): void {
    const begin = (): void => { void this.audio.unlock().then(() => this.syncMusic()).catch(() => undefined); };
    window.addEventListener('pointerdown', begin, { once: true });
    window.addEventListener('keydown', begin, { once: true });
  }

  private async handleAction(action: string, data: DOMStringMap): Promise<void> {
    switch (action) {
      case 'new-game': this.openSlots('new'); break;
      case 'continue': this.openSlots('continue'); break;
      case 'slots-back': this.screen = 'menu'; this.confirm = null; this.audio.play('click'); break;
      case 'tutorial': case 'achievements': this.audio.play('click'); break;
      case 'confirm-accept': { const request = this.confirm; this.confirm = null; this.audio.play('click'); request?.run(); break; }
      case 'confirm-cancel': this.confirm = null; this.audio.play('click'); break;
      case 'slot-create': this.startCharacterCreation(Number(data.slot)); break;
      case 'slot-overwrite': this.overwriteSlot(Number(data.slot)); break;
      case 'slot-continue': this.continueGame(Number(data.slot)); break;
      case 'slot-delete': this.deleteSlot(Number(data.slot)); break;
      case 'draft-set': this.applyDraft(data.field ?? '', data.value ?? ''); break;
      case 'create-back': this.createPreviousStep(); break;
      case 'create-next': this.createNextStep(); break;
      case 'menu': this.returnToMenu(); break;
      case 'settings': this.screen = 'settings'; this.audio.play('click'); break;
      case 'settings-back': this.screen = this.game ? 'game' : 'menu'; this.audio.play('click'); break;
      case 'editor': window.location.href = '/editor.html'; break;
      case 'exit': window.close(); this.screen = 'exit'; break;
      case 'fullscreen': await this.toggleFullscreen(); break;
      case 'clear-save': this.clearSave(); break;
      case 'move': this.move(data.direction as Direction); break;
      case 'hotspot': this.interact(data.hotspot as HotspotId); break;
      case 'inventory': this.inventoryOpen = !this.inventoryOpen; if (!this.inventoryOpen) this.focusedItem = null; this.audio.play('click'); break;
      case 'focus-item': this.focusedItem = data.item as ItemId; this.audio.play('click'); this.updateInventoryFocus(); return;
      case 'use-item': this.useItem(data.item as ItemId); break;
      case 'examine-item': this.game?.examineItem(data.item as ItemId); this.inventoryOpen = false; break;
      case 'discard-item': this.game?.discardItem(data.item as ItemId); this.focusedItem = null; this.persist(); break;
      case 'encounter': this.respond(data.choice as EncounterAction); break;
      case 'exit-hideout': this.game?.exitHideout(); this.audio.play('step'); break;
      case 'resume': this.resumeFromPause(); break;
      case 'dev-toggle': this.devPanelOpen = !this.devPanelOpen; break;
      case 'dev-voice': this.forceVocalization(data.metric ?? ''); return;
      case 'dev-add-item': {
        const select = this.root.querySelector<HTMLSelectElement>('[data-dev-item]');
        if (select) this.game?.debugAddItem(select.value as ItemId);
        break;
      }
    }
    this.syncMusic();
    this.forcePaint = true;
    this.render(true);
  }

  // --- campanhas ---

  /** Um registro criado basta para o menu passar a oferecer continuidade. */
  private hasAnyRecord(): boolean { return this.save.slots.some((slot) => slot !== null); }

  /**
   * Lê o projeto do editor antes de a partida existir: as miniaturas dos registros e
   * os itens oferecidos na criação precisam vir do mapa que será jogado, não do padrão.
   */
  private indexProjectRooms(): void {
    if (Object.keys(this.roomImages).length > 0) return;
    try {
      const project = new EditorProject();
      const world = projectToWorld(project.data.levels, project.data.activeLevelId);
      this.roomLevelNames = world.roomLevelName;
      this.roomImages = Object.fromEntries(Object.values(world.rooms).map((room) => [room.id, room.image]));
      this.items = itemsToRuntime(project.data.items);
    } catch { /* sem projeto salvo as miniaturas e os itens usam o padrão */ }
  }

  private openSlots(mode: SlotMode): void {
    this.indexProjectRooms();
    this.slotMode = mode;
    this.screen = 'slots';
    this.game = null;
    this.activeSlot = null;
    this.inventoryOpen = false;
    this.audio.play('click');
  }

  private startCharacterCreation(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= SAVE_SLOT_COUNT) return;
    this.activeSlot = index;
    this.draft = emptyDraft();
    this.createStep = 'gender';
    this.screen = 'create';
    this.audio.play('click');
  }

  private overwriteSlot(index: number): void {
    const slot = this.save.slots[index];
    if (!slot) { this.startCharacterCreation(index); return; }
    this.askConfirm({
      title: `Substituir o registro ${String(index + 1).padStart(2, '0')}`,
      message: `O personagem "${slot.character.name}" e todo o progresso dele serão trocados por um personagem novo.`,
      confirmLabel: 'Criar personagem novo',
      danger: false,
      run: () => { this.startCharacterCreation(index); this.forcePaint = true; this.render(true); },
    });
  }

  private deleteSlot(index: number): void {
    const slot = this.save.slots[index];
    if (!slot) return;
    this.askConfirm({
      title: `Apagar o registro ${String(index + 1).padStart(2, '0')}`,
      message: `"${slot.character.name}" será removido deste navegador. Isso não pode ser desfeito.`,
      confirmLabel: 'Apagar registro',
      danger: true,
      run: () => {
        this.save.slots[index] = null;
        if (this.save.activeSlot === index) this.save.activeSlot = null;
        this.persistSave();
        this.forcePaint = true;
        this.render(true);
      },
    });
  }

  /** Volta ao menu principal: o áudio do jogo para por completo. */
  private returnToMenu(): void {
    this.screen = 'menu';
    this.game = null;
    this.activeSlot = null;
    this.inventoryOpen = false;
    this.confirm = null;
    this.immersive = false;
    this.inventoryHintUntil = 0;
    this.audio.stopAll();
    this.audio.play('click');
  }

  /** Sai da pausa: o áudio congelado volta de onde parou. */
  private resumeFromPause(): void {
    this.autoPaused = false;
    this.game?.pause(false);
    void this.audio.resumeGameplay().then(() => this.audio.play('click')).catch(() => undefined);
  }

  /** Uma escolha por passo: marcar uma opção substitui a anterior, nunca soma. */
  private applyDraft(field: string, value: string): void {
    if (field === 'gender' && (value === 'male' || value === 'female')) this.draft.gender = value;
    else if (field === 'classId') this.draft.classId = value as CharacterClassId;
    else if (field === 'phobia') this.draft.phobia = value as PhobiaId;
    else if (field === 'startingItem') this.draft.startingItem = value;
    else if (field === 'mode' && (value === 'classic' || value === 'immersive')) this.draft.mode = value;
    this.audio.play('click');
  }

  private createPreviousStep(): void {
    const index = CREATE_STEPS.indexOf(this.createStep);
    this.audio.play('click');
    if (index <= 0) { this.screen = 'slots'; return; }
    this.createStep = CREATE_STEPS[index - 1]!;
  }

  private createNextStep(): void {
    if (!this.createStepReady(this.createStep)) return;
    const index = CREATE_STEPS.indexOf(this.createStep);
    this.audio.play('click');
    if (index < CREATE_STEPS.length - 1) { this.createStep = CREATE_STEPS[index + 1]!; return; }
    this.beginNewGame();
  }

  private beginNewGame(): void {
    if (this.activeSlot === null) { this.openSlots('new'); return; }
    const character: CharacterProfile = {
      name: sanitizeCharacterName(this.draft.name) || DEFAULT_CHARACTER.name,
      gender: this.draft.gender ?? DEFAULT_CHARACTER.gender,
      classId: this.draft.classId ?? DEFAULT_CHARACTER.classId,
      phobia: this.draft.phobia ?? DEFAULT_CHARACTER.phobia,
      startingItem: this.draft.startingItem ?? DEFAULT_CHARACTER.startingItem,
      mode: this.draft.mode ?? DEFAULT_CHARACTER.mode,
    };
    const data = this.currentGameData();
    this.items = data.items;
    this.levelName = data.levelName;
    this.worldRoomCount = Object.keys(data.world.rooms).length;
    this.immersive = character.mode === 'immersive';
    this.game = new Game(undefined, Math.random, data.world, undefined, data.items, data.entities);
    this.game.grantStartingItem(character.startingItem);
    // Receber o item inicial já é receber um item: a caixa aparece e some sozinha.
    this.showInventoryHint();
    this.save.slots[this.activeSlot] = createSlot(character);
    this.save.activeSlot = this.activeSlot;
    this.screen = 'game';
    this.inventoryOpen = false;
    this.focusedItem = null;
    this.seenAttackNonce = 0;
    this.jumpscareUntil = 0;
    this.autoPaused = false;
    this.dangerSoundTier = 0;
    this.nextDangerSoundAt = 0;
    this.audio.resetScheduling();
    this.audio.setVoiceGender(character.gender);
    this.persist();
    this.audio.play('step');
    this.syncMusic();
    this.syncRoomAudio();
  }

  private continueGame(index: number): void {
    const slot = this.save.slots[index];
    if (!slot?.game) return;
    const data = this.currentGameData();
    this.items = data.items;
    this.levelName = data.levelName;
    this.worldRoomCount = Object.keys(data.world.rooms).length;
    this.activeSlot = index;
    this.save.activeSlot = index;
    this.immersive = slot.character.mode === 'immersive';
    this.game = new Game(slot.game, Math.random, data.world, undefined, data.items, data.entities);
    this.screen = 'game';
    this.inventoryOpen = false;
    this.focusedItem = null;
    // A partida é nova para a tela: sem zerar isto, um ataque da campanha anterior
    // ainda contado disparava um susto no instante em que o registro abria.
    this.seenAttackNonce = 0;
    this.jumpscareUntil = 0;
    this.autoPaused = false;
    this.dangerSoundTier = 0;
    this.nextDangerSoundAt = 0;
    this.audio.resetScheduling();
    this.audio.setVoiceGender(slot.character.gender);
    this.audio.play('step');
    this.syncMusic();
    this.syncRoomAudio();
  }

  private move(direction: Direction): void {
    if (!this.game) return;
    const result = this.game.navigate(direction);
    this.audio.play(result.changed ? 'step' : 'locked');
    if (this.game.status === 'encounter') this.audio.play('entity');
    if (result.changed) this.onRoomEntered();
    this.persist();
  }

  private interact(id: HotspotId): void {
    if (!this.game) return;
    const previousRoom = this.game.position;
    const result = this.game.interact(id);
    this.showInventoryHint();
    this.audio.play(result.pickup ? 'pickup' : result.changed ? 'use' : 'click');
    if (this.game.status === 'hidden' && this.game.pursued) this.audio.playSample(FX_PANIC_ATTACK);
    if (this.game.position !== previousRoom) this.onRoomEntered();
    this.persist();
  }

  /** Sala nova: acerta a música do nível e, se nada estranho mora aqui, pode soltar um alívio. */
  private onRoomEntered(): void {
    const game = this.game;
    if (!game) return;
    this.syncMusic();
    this.syncRoomAudio();
    if (!game.roomIsOrdinary) return;
    this.audio.maybePlaySample(FX_SAFE_ROOM, { chance: SAFE_ROOM_CHANCE });
  }

  private useItem(id: ItemId): void {
    if (!this.game) return;
    const result = this.game.useItem(id);
    this.audio.play(result.changed ? 'use' : 'click');
    this.inventoryOpen = result.changed ? false : !this.game.selectedItem;
    this.focusedItem = null;
    this.persist();
  }

  private respond(action: EncounterAction): void {
    if (!this.game) return;
    const entityImage = this.game.encounter?.image ?? this.jumpscareImage;
    const result = this.game.respondToEncounter(action);
    if (result.attack) { this.jumpscareImage = entityImage; this.seenAttackNonce = this.game.attackNonce; this.triggerJumpscare(this.game.encounter?.jumpscareDuration); }
    else {
      this.audio.play('step');
      // Escapou se escondendo de algo que o perseguia: ataque de pânico.
      if (action === 'hide') this.audio.playSample(FX_PANIC_ATTACK);
    }
    this.persist();
  }

  private triggerJumpscare(entityDuration?: number): void {
    const baseDuration = (entityDuration ?? 1.55) * 1000;
    const duration = baseDuration * (0.4 + this.save.preferences.jumpscareIntensity * 0.6);
    this.jumpscareUntil = Date.now() + Math.max(300, duration);
    this.audio.play('jumpscare');
    this.audio.playSample(FX_HURT);
    this.forcePaint = true;
  }

  private updateDangerAmbience(): void {
    if (!this.game || this.game.status !== 'exploring') return;
    const danger = this.game.danger;
    const tier = danger >= 80 ? 4 : danger >= 60 ? 3 : danger >= 40 ? 2 : danger >= 20 ? 1 : 0;
    if (tier === 0) { this.dangerSoundTier = 0; return; }
    const now = Date.now();
    if (tier !== this.dangerSoundTier || now >= this.nextDangerSoundAt) {
      this.dangerSoundTier = tier;
      const options = DANGER_CUES[tier]!;
      const cue = options[Math.floor(Math.random() * options.length)]!;
      const pan = tier >= 2 ? Math.random() * 2 - 1 : 0;
      this.audio.play(cue, pan);
      const [min, max] = DANGER_INTERVALS[tier]!;
      this.nextDangerSoundAt = now + min + Math.random() * (max - min);
    }
  }

  /** Efeitos gravados que acompanham o estado do jogador; o ritmo fica com o AudioSystem. */
  private updateSampleAmbience(): void {
    const game = this.game;
    if (!game) return;
    if (game.status !== 'exploring' && game.status !== 'hidden') return;
    const { health, hunger, thirst } = game.stats;
    if (thirst <= THIRST_LOW_THRESHOLD) this.audio.maybePlaySample(FX_THIRST_LOW);
    else if (thirst <= THIRST_THRESHOLD) this.audio.maybePlaySample(FX_THIRST);
    if (hunger <= HUNGER_LOW_THRESHOLD) this.audio.maybePlaySample(FX_HUNGER_LOW);
    else if (hunger <= HUNGER_THRESHOLD) this.audio.maybePlaySample(FX_HUNGER);
    if (health <= 30) this.audio.maybePlaySample(FX_LOW_HEALTH);
    // A voz do personagem sai dele mesmo: sem panorâmica, nos dois ouvidos.
    this.audio.maybePlaySample(anxietyCategoryFor(game.anxietyLevel));
    if (game.danger >= 40) this.audio.maybePlaySample(FX_SCREAM);
  }

  /** Categoria que cada métrica toca no estado atual do personagem. */
  private vocalCategoryFor(metric: string): string | null {
    const game = this.game;
    if (!game) return null;
    switch (metric) {
      case 'health': return FX_LOW_HEALTH;
      case 'hunger': return game.stats.hunger <= HUNGER_LOW_THRESHOLD ? FX_HUNGER_LOW : FX_HUNGER;
      case 'thirst': return game.stats.thirst <= THIRST_LOW_THRESHOLD ? FX_THIRST_LOW : FX_THIRST;
      case 'anxiety': return anxietyCategoryFor(game.anxietyLevel);
      case 'danger': return FX_SCREAM;
      default: return null;
    }
  }

  /**
   * DEV: toca agora a vocalização da métrica e diz no painel o que saiu. A escolha do
   * arquivo é sequencial, nunca sorteada: cada clique avança um arquivo da pasta, de
   * modo que apertar o botão várias vezes percorre a categoria inteira em ordem.
   */
  private forceVocalization(metric: string): void {
    const category = this.vocalCategoryFor(metric);
    const status = this.root.querySelector<HTMLElement>('[data-role="dev-voice-status"]');
    if (!category) return;
    const position = this.audio.sequencePosition(category);
    const played = this.audio.forceSample(category, { sequential: true });
    const name = categoryLabel(category);
    const order = position ? ` (${position.index + 1}/${position.total})` : '';
    if (status) status.textContent = played ? `tocando ${name}${order}` : `sem arquivo em ${name}`;
  }

  /** Menu tem a música do menu; o nível 0 tem lobby_lights em todas as salas. */
  private syncMusic(): void {
    if (this.screen === 'gameover' || this.screen === 'escaped') { this.audio.setMusic(null); return; }
    if (this.game && (this.screen === 'game' || this.screen === 'settings')) {
      this.audio.setMusic(this.levelZeroActive() ? MUSIC_LOBBY : null);
      return;
    }
    this.audio.setMusic(MUSIC_MENU);
  }

  private levelZeroActive(): boolean {
    const room = this.game?.room;
    // Com caminhos entre níveis a sala manda: o nome do nível vem da sala, não do início.
    const levelName = (room && this.roomLevelNames[room.id]) ?? this.levelName;
    return isLevelZero(levelName, room?.code, room?.image);
  }

  private handleInput(input: HTMLInputElement): void {
    if (input.dataset.draft === 'name') {
      this.draft.name = input.value.slice(0, MAX_CHARACTER_NAME);
      const next = this.root.querySelector<HTMLButtonElement>('[data-action="create-next"]');
      if (next) next.disabled = !this.createStepReady('name');
      // O aviso é atualizado à mão pelo mesmo motivo do botão: redesenhar a tela a
      // cada letra tirava o foco do campo.
      const warning = this.root.querySelector<HTMLElement>('[data-role="name-warning"]');
      if (warning) {
        const problem = this.nameProblem();
        warning.textContent = problem;
        warning.hidden = !problem;
      }
      return;
    }
    const debugStat = input.dataset.devStat as 'health' | 'hunger' | 'thirst' | 'anxiety' | undefined;
    if (debugStat && this.game) {
      this.game.debugSetStat(debugStat, Number(input.value));
      this.updateReadouts();
      return;
    }
    if (input.hasAttribute('data-dev-danger') && this.game) {
      this.game.debugSetDanger(Number(input.value));
      return;
    }
    if (input.hasAttribute('data-dev-invincible') && this.game) {
      this.game.setInvincible(input.checked);
      return;
    }
    if (input.hasAttribute('data-dev-health-bar')) {
      this.save.preferences.showHealthBar = input.checked;
      this.persistSave();
      this.forcePaint = true;
      this.render(true);
      return;
    }
    const key = input.dataset.setting as NumericPreferenceKey | undefined;
    if (!key) return;
    this.save.preferences[key] = Number(input.value);
    this.audio.updatePreferences(this.save.preferences);
    this.persistSave();
    const value = input.closest('label')?.querySelector('b');
    if (value) value.textContent = `${Math.round(Number(input.value) * 100)}%`;
  }

  private handleKey(event: KeyboardEvent): void {
    if (this.screen === 'create' && event.key === 'Enter') {
      event.preventDefault();
      this.createNextStep();
      this.forcePaint = true;
      this.render(true);
      return;
    }
    if (event.key === 'Tab' && this.screen === 'game') { event.preventDefault(); return; }
    const key = event.key.toLowerCase();
    if (key === 'i' && this.screen === 'game' && this.game && (this.inventoryOpen || this.game.status === 'exploring')) {
      this.inventoryOpen = !this.inventoryOpen;
      if (!this.inventoryOpen) this.focusedItem = null;
      this.audio.play('click');
      this.forcePaint = true;
      this.render(true);
      return;
    }
    if (event.key === 'Escape') {
      if (this.inventoryOpen) { this.inventoryOpen = false; this.focusedItem = null; this.forcePaint = true; this.render(true); return; }
      if (this.screen === 'create') { this.createPreviousStep(); this.forcePaint = true; this.render(true); return; }
      if (this.screen === 'slots') { this.screen = 'menu'; this.forcePaint = true; this.render(true); return; }
      if (this.screen === 'game' && this.game && (this.game.status === 'exploring' || this.game.status === 'paused')) {
        if (this.game.status === 'paused') { this.resumeFromPause(); }
        else {
          this.autoPaused = false;
          this.game.pause(true);
          this.audio.play('click');
          // O som do jogo congela junto com ele e volta exatamente daqui.
          void this.audio.pauseGameplay().catch(() => undefined);
        }
        this.forcePaint = true;
        this.render(true);
      }
      return;
    }
    if (this.screen !== 'game' || this.inventoryOpen || this.game?.status !== 'exploring') return;
    const directions: Record<string, Direction> = { ArrowUp: 'forward', w: 'forward', ArrowDown: 'back', s: 'back', ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right' };
    const direction = directions[event.key];
    if (direction) { this.move(direction); this.forcePaint = true; this.render(true); }
  }

  private updateReadouts(): void {
    if (!this.game) return;
    (['health', 'hunger', 'thirst', 'anxiety'] as const).forEach((key) => {
      const stat = this.root.querySelector<HTMLElement>(`[data-stat="${key}"]`);
      const value = this.game!.stats[key];
      const bar = stat?.querySelector<HTMLElement>('i');
      if (bar) bar.style.width = `${value}%`;
      if (key === 'anxiety') {
        const tier = anxietyTier(value);
        const readout = stat?.querySelector<HTMLElement>('b');
        if (readout) readout.textContent = anxietyTierLabel(value);
        stat?.classList.remove('danger', 'warning');
        (['calm', 'uneasy', 'terrified'] as const).forEach((name) => stat?.classList.toggle(`anx-${name}`, name === tier));
        return;
      }
      stat?.classList.toggle('danger', value <= 25);
      stat?.classList.toggle('warning', value > 25 && value <= 50);
    });
    this.updateDevMeters();
    this.updateNowPlaying();
    const screen = this.root.querySelector<HTMLElement>('.game-screen');
    // O modo imersivo é parte da classe da tela: reescrevê-la sem ele tirava a marca
    // que esconde a interface até o próximo redesenho estrutural.
    if (screen) screen.className = `game-screen ${this.conditionClasses()}${this.immersive ? ' immersive' : ''}`;
    const blood = this.root.querySelector<HTMLElement>('.blood-overlay');
    if (blood) blood.dataset.bloodLevel = String(this.bloodLevel());
    if (this.game.encounter) {
      const timer = this.root.querySelector<HTMLElement>('.decision-timer i');
      if (timer) timer.style.width = `${(this.game.encounter.remaining / this.game.encounter.timeLimit) * 100}%`;
    }
    if (this.game.cutscene) {
      const cutscene = this.game.cutscene;
      const progress = cutscene.mediaType === 'image'
        ? (cutscene.holdSeconds > 0 ? cutscene.elapsed / cutscene.holdSeconds : 1)
        : (cutscene.repeatCount > 0 ? cutscene.loopsCompleted / cutscene.repeatCount : 1);
      const bar = this.root.querySelector<HTMLElement>('.cutscene-progress i');
      if (bar) bar.style.width = `${Math.min(100, Math.max(0, progress * 100))}%`;
    }
  }

  /** Mantém os medidores do DEV em tempo real, com o painel aberto ou fechado. */
  private updateDevMeters(): void {
    const game = this.game;
    if (!game) return;
    const values: Record<string, number> = {
      health: game.stats.health, thirst: game.stats.thirst, hunger: game.stats.hunger,
      anxiety: game.stats.anxiety, danger: game.danger,
    };
    this.root.querySelectorAll<HTMLElement>('[data-dev-meter]').forEach((meter) => {
      const key = meter.dataset.devMeter ?? '';
      const value = values[key];
      if (value === undefined) return;
      const readout = meter.querySelector('b');
      if (readout) readout.textContent = String(Math.round(value));
      const bar = meter.querySelector<HTMLElement>('em');
      if (bar) bar.style.width = `${value}%`;
      meter.classList.toggle('critical', key === 'danger' || key === 'anxiety' ? value >= 60 : value <= 25);
    });
  }

  private updateInventoryFocus(): void {
    this.root.querySelectorAll<HTMLElement>('.item-slot[data-item]').forEach((slot) => slot.classList.toggle('focused', slot.dataset.item === this.focusedItem));
    const details = this.root.querySelector<HTMLElement>('.item-details');
    if (details) details.innerHTML = this.itemDetailsTemplate(this.focusedItem);
  }

  private persist(): void {
    // Campanha encerrada não volta para o save: o fim já tirou o progresso do registro.
    if (!this.game || this.activeSlot === null || this.game.status === 'gameover' || this.game.status === 'escaped') return;
    const slot = this.save.slots[this.activeSlot];
    if (!slot) return;
    slot.game = this.game.toSave();
    // Campanha em andamento não carrega a marca de uma campanha anterior.
    slot.ending = undefined;
    slot.updatedAt = new Date().toISOString();
    this.save.updatedAt = slot.updatedAt;
    this.persistSave();
  }

  /**
   * Fim de campanha: o personagem continua no registro, o progresso é zerado e no
   * lugar dele fica a marca de como a campanha acabou.
   */
  private clearActiveGame(kind: CampaignEnding['kind']): void {
    if (this.activeSlot === null) return;
    const game = this.game;
    const ending: CampaignEnding | undefined = game
      ? { kind, room: game.room.name, roomId: game.position, elapsed: game.elapsed }
      : undefined;
    endCampaign(this.save, this.activeSlot, ending);
    // Soltar o registro fecha a porta: nenhuma gravação posterior ressuscita o progresso.
    this.activeSlot = null;
    this.persistSave();
  }

  private persistSave(): void { this.saves.save(this.save); }

  private clearSave(): void {
    this.askConfirm({
      title: 'Apagar o save local',
      message: 'Todos os registros e as configurações guardadas neste navegador serão removidos.',
      confirmLabel: 'Apagar tudo',
      danger: true,
      run: () => { this.wipeSave(); this.forcePaint = true; this.render(true); },
    });
  }

  private wipeSave(): void {
    this.audio.stopAll();
    this.saves.clear();
    this.save = this.saves.load();
    this.audio.updatePreferences(this.save.preferences);
    this.game = null;
    this.activeSlot = null;
    this.inventoryOpen = false;
    this.screen = 'menu';
  }

  private currentGameData() {
    const project = new EditorProject();
    const world = projectToWorld(project.data.levels, project.data.activeLevelId);
    this.roomLevelNames = world.roomLevelName;
    this.roomImages = Object.fromEntries(Object.values(world.rooms).map((room) => [room.id, room.image]));
    return {
      levelName: project.activeLevel.name,
      world,
      items: itemsToRuntime(project.data.items),
      entities: entitiesToRuntime(project.data.entities),
    };
  }

  /**
   * Trilha presa à sala, configurada no editor. "Uma vez" marca uma bandeira no save
   * e nunca mais volta; "a cada entrada" recomeça; "contínua" fica em laço.
   */
  private syncRoomAudio(): void {
    const game = this.game;
    if (!game) return;
    const room = game.room as RoomDefinition;
    const audio = room.audio;
    if (!audio?.path) { this.audio.stopRoomTrack(); return; }
    const flag = `audio:${room.id}`;
    if (audio.mode === 'once' && game.flags[flag]) { this.audio.stopRoomTrack(); return; }
    // A bandeira do "uma vez" só queima quando a faixa realmente entra: marcá-la antes
    // gastava a única execução quando o volume estava em zero ou o arquivo não carregou.
    void this.audio.playRoomTrack(audio.path, { loop: audio.mode === 'loop', volume: audio.volume })
      .then((started) => { if (started && audio.mode === 'once') game.flags[flag] = true; })
      .catch(() => undefined);
  }

  private bloodLevel(): number {
    const health = this.game?.stats.health ?? 100;
    return health <= 25 ? 3 : health <= 50 ? 2 : health <= 75 ? 1 : 0;
  }

  private conditionClasses(): string {
    if (!this.game) return '';
    const { thirst, hunger } = this.game.stats;
    return [
      thirst <= 10 ? 'thirst-critical' : '',
      hunger <= 10 ? 'hunger-critical' : hunger <= 30 ? 'hunger-low' : '',
      `anxiety-${this.game.anxietyLevel}`,
    ].filter(Boolean).join(' ');
  }

  private async toggleFullscreen(): Promise<void> {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
    this.forcePaint = true;
  }

  private formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    return `${String(minutes).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  }
}
