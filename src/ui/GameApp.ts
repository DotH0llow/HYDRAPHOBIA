import { ITEMS, type ItemDefinition, type RoomDefinition } from '../config/world';
import { Game } from '../core/Game';
import { EditorProject } from '../editor/EditorProject';
import { entitiesToRuntime, itemsToRuntime, levelToWorld } from '../editor/mapAdapter';
import { anxietyTier, anxietyTierLabel } from '../core/anxiety';
import { AudioSystem, type Cue } from '../systems/AudioSystem';
import {
  FX_ANXIETY, FX_HUNGER, FX_HUNGER_LOW, FX_HURT, FX_LOW_HEALTH, FX_PANIC_ATTACK, FX_SAFE_ROOM, FX_SCREAM, FX_THIRST, FX_THIRST_LOW,
  isLevelZero, MUSIC_LOBBY, MUSIC_MENU,
} from '../systems/audioLibrary';
import { SaveSystem } from '../systems/SaveSystem';
import type { Direction, EncounterAction, HotspotId, ItemId, Preferences, SaveData, Screen } from '../types';

type NumericPreferenceKey = Exclude<keyof Preferences, 'showHealthBar'>;

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
      if (this.game.status === 'gameover' && Date.now() >= this.jumpscareUntil) { this.screen = 'gameover'; this.forcePaint = true; }
      if (this.game.status === 'escaped') { this.screen = 'escaped'; this.audio.play('escape'); this.save.game = null; this.persistSave(); this.forcePaint = true; }
      this.updateDangerAmbience();
      this.updateSampleAmbience();
    }
    this.render();
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
    const darkness = room.darknessLevel ?? 0;
    const lights = room.lights ?? [];
    canvas.width = canvas.offsetWidth || canvas.parentElement?.clientWidth || 800;
    canvas.height = canvas.offsetHeight || canvas.parentElement?.clientHeight || 600;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (darkness <= 0 && lights.length === 0) return;
    ctx.fillStyle = `rgba(0,0,0,${darkness})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (lights.length > 0) {
      ctx.globalCompositeOperation = 'destination-out';
      for (const light of lights) {
        const cx = (light.x / 100) * canvas.width;
        const cy = (light.y / 100) * canvas.height;
        const r = (light.radius / 100) * canvas.width;
        const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grd.addColorStop(0, `rgba(0,0,0,${light.intensity})`);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  private structureKey(): string {
    if (this.screen !== 'game' || !this.game) return `${this.screen}:${this.inventoryOpen}:${this.focusedItem ?? ''}:${JSON.stringify(this.save.preferences)}`;
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
      showHealthBar: this.save.preferences.showHealthBar,
      anxietyTier: this.game.anxietyLevel,
      jumpscare: Date.now() < this.jumpscareUntil,
    });
  }

  private template(): string {
    switch (this.screen) {
      case 'menu': return this.menuTemplate();
      case 'game': return this.gameTemplate();
      case 'settings': return this.settingsTemplate();
      case 'gameover': return this.gameOverTemplate();
      case 'escaped': return this.escapedTemplate();
      case 'exit': return this.exitTemplate();
    }
  }

  private menuTemplate(): string {
    return `<main class="menu-screen">
      <img class="menu-bg" src="/assets/scenes/reception.jpg" alt="Corredores amarelos vazios" />
      <div class="analog-noise" aria-hidden="true"></div><div class="menu-shadow" aria-hidden="true"></div>
      <section class="menu-panel">
        <p class="overline">REGISTRO DE EXPLORAÇÃO // 00</p>
        <h1>MIMOSFERATU</h1>
        <p class="subtitle">Você não deveria ter atravessado aquela parede.</p>
        <nav class="menu-actions">
          <button class="primary" data-action="new-game"><span>01</span>Novo jogo</button>
          <button data-action="continue" ${this.save.game ? '' : 'disabled'}><span>02</span>Continuar</button>
          <button data-action="settings"><span>03</span>Configurações</button>
          <button data-action="editor"><span>04</span>Editor de salas</button>
          <button data-action="exit"><span>05</span>Sair</button>
        </nav>
        <p class="menu-foot">Use fones de ouvido · Progresso salvo localmente</p>
      </section>
      <div class="status-code">NÍVEL 0<br><b>LOCALIZAÇÃO DESCONHECIDA</b></div>
    </main>`;
  }

  private gameTemplate(): string {
    if (!this.game) return '';
    const room = this.game.room;
    const exits = Object.entries(room.exits) as Array<[Direction, NonNullable<typeof room.exits[Direction]>]>;
    const condition = this.conditionClasses();
    return `<main class="game-screen ${condition}">
      <section class="scene" aria-label="${room.name}">
        <img src="${room.image}" alt="${room.description}" />
        <div class="scene-grade"></div><div class="scene-noise"></div>
        <canvas class="scene-darkness-canvas" data-role="scene-darkness" aria-hidden="true"></canvas>
        ${this.hotspotMarkup(room)}
      </section>
      <div class="blood-overlay" data-blood-level="${this.bloodLevel()}" aria-hidden="true"><i></i><i></i><i></i></div>
      <header class="game-header">
        <div class="room-id"><small>${room.code}</small><strong>${room.name}</strong></div>
        <div class="survival-bars">
          ${this.statBar('anxiety', 'ANSIEDADE', this.game.stats.anxiety)}
          ${this.statBar('thirst', 'SEDE', this.game.stats.thirst)}
          ${this.statBar('hunger', 'FOME', this.game.stats.hunger)}
          ${this.save.preferences.showHealthBar ? this.statBar('health', 'VIDA', this.game.stats.health) : ''}
        </div>
      </header>
      <nav class="movement" aria-label="Movimentação">
        ${exits.map(([direction, exit]) => this.movementButton(direction, exit)).join('')}
      </nav>
      <div class="message-strip" role="status"><i></i><p>${this.game.message}</p></div>
      <button class="inventory-button ${this.game.selectedItem ? 'item-selected' : ''}" data-action="inventory"><span>▦</span><b>Inventário</b><small>${this.game.inventory.reduce((sum, item) => sum + item.quantity, 0)} itens</small></button>
      ${this.inventoryOpen ? this.inventoryTemplate() : ''}
      ${this.game.encounter ? this.encounterTemplate() : ''}
      ${this.game.status === 'cutscene' ? this.cutsceneTemplate() : ''}
      ${this.game.status === 'hidden' ? this.hiddenTemplate() : ''}
      ${this.game.status === 'paused' ? this.pauseTemplate() : ''}
      ${Date.now() < this.jumpscareUntil ? this.jumpscareTemplate() : ''}
      ${this.devToolsTemplate()}
    </main>`;
  }

  private movementButton(direction: Direction, exit: { to: string; label: string; requires?: string; buttonX?: number; buttonY?: number; arrowRotation?: number }): string {
    const locked = exit.requires && !this.game!.flags[exit.requires];
    const fallback = this.defaultButtonPosition(direction);
    const x = exit.buttonX ?? fallback.x;
    const y = exit.buttonY ?? fallback.y;
    const rotation = exit.arrowRotation ?? this.defaultArrowRotation(direction);
    return `<button class="move-btn ${locked ? 'locked' : ''}" data-action="move" data-direction="${direction}" aria-label="${exit.label}" style="left:${x}%;top:${y}%"><i style="--rotate:${rotation}deg">↑</i><span>${exit.label}</span></button>`;
  }

  private defaultButtonPosition(direction: Direction): { x: number; y: number } {
    return ({ forward: { x: 50, y: 16 }, back: { x: 50, y: 82 }, left: { x: 3, y: 50 }, right: { x: 97, y: 50 } } as Record<string, { x: number; y: number }>)[direction] ?? { x: 50, y: 50 };
  }

  private defaultArrowRotation(direction: Direction): number {
    return ({ forward: 0, back: 180, left: 270, right: 90 } as Record<string, number>)[direction] ?? 45;
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
      return `<div class="hotspot-group${invisible ? ' hotspot-invisible' : ''}" style="--x:${hotspot.x}%;--y:${hotspot.y}%;--w:${hotspot.width}%;--h:${hotspot.height}%">
        <button class="hotspot-hitbox" data-action="hotspot" data-hotspot="${hotspot.id}" style="${clip}" aria-label="${hotspot.label}"></button>
        <i class="hotspot-marker${invisible ? ' invisible-hotspot' : ''}" style="left:${indicator.x}%;top:${indicator.y}%"></i>
        <span class="hotspot-label" style="left:${indicator.x}%;top:${indicator.y}%">${hotspot.label}</span>
      </div>`;
    }).join('');
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
    return `<main class="settings-screen"><img src="/assets/scenes/corridor.jpg" alt="" /><div class="settings-shade"></div><section class="settings-panel"><small>CONFIGURAÇÃO DO REGISTRO</small><h1>Configurações</h1>${this.range('masterVolume', 'Volume geral', p.masterVolume)}${this.range('musicVolume', 'Ambiente / música', p.musicVolume)}${this.range('effectsVolume', 'Efeitos sonoros', p.effectsVolume)}<label class="setting-select"><span>Intensidade dos sustos</span><select data-setting="jumpscareIntensity"><option value="0.25" ${p.jumpscareIntensity < .45 ? 'selected' : ''}>Baixa</option><option value="0.6" ${p.jumpscareIntensity >= .45 && p.jumpscareIntensity < .8 ? 'selected' : ''}>Média</option><option value="1" ${p.jumpscareIntensity >= .8 ? 'selected' : ''}>Alta</option></select></label><p class="setting-help">Controla o tremor, o flash, a duração e parte da força sonora do susto. Os controles de volume continuam valendo separadamente.</p><button data-action="fullscreen">${document.fullscreenElement ? 'Sair da tela cheia' : 'Ativar tela cheia'}</button><button class="danger-button" data-action="clear-save">Apagar save local</button><button class="primary" data-action="settings-back">Voltar</button></section></main>`;
  }

  private devToolsTemplate(): string {
    if (!this.game) return '';
    if (!this.devPanelOpen) return `<button class="dev-toggle" data-action="dev-toggle">DEV</button>`;
    const itemOptions = Object.entries(this.items).map(([id, item]) => `<option value="${id}">${item.name}</option>`).join('');
    return `<aside class="dev-panel"><header><b>DEV cheats</b><button data-action="dev-toggle">×</button></header>
      ${(['health', 'thirst', 'hunger', 'anxiety'] as const).map((key) => `<label><span>${key}</span><input type="number" min="0" max="100" value="${Math.round(this.game!.stats[key])}" data-dev-stat="${key}" /></label>`).join('')}
      <label><span>perigo</span><input type="number" min="0" max="100" value="${Math.round(this.game.danger)}" data-dev-danger /></label>
      <label class="dev-check"><input type="checkbox" data-dev-invincible ${this.game.invincible ? 'checked' : ''} /><span>Invencibilidade</span></label>
      <label class="dev-check"><input type="checkbox" data-dev-health-bar ${this.save.preferences.showHealthBar ? 'checked' : ''} /><span>Mostrar barra de vida</span></label>
      <div class="dev-add"><select data-dev-item>${itemOptions}</select><button data-action="dev-add-item">Adicionar item</button></div>
    </aside>`;
  }

  private range(key: NumericPreferenceKey, label: string, value: number): string {
    return `<label class="setting-range"><span>${label}<b>${Math.round(value * 100)}%</b></span><input type="range" min="0" max="1" step="0.05" value="${value}" data-setting="${key}" /></label>`;
  }

  private gameOverTemplate(): string {
    return `<main class="end-screen gameover"><div class="end-noise"></div><section><small>REGISTRO INTERROMPIDO</small><h1>VOCÊ SE PERDEU</h1><p>Os corredores continuam. Sem você.</p><button class="primary" data-action="new-game">Recomeçar</button><button data-action="menu">Menu principal</button></section></main>`;
  }

  private escapedTemplate(): string {
    const time = this.game ? this.formatTime(this.game.elapsed) : '—';
    return `<main class="end-screen escaped"><img src="/assets/scenes/maintenance.jpg" alt="Saída de manutenção" /><div class="escape-light"></div><section><small>ROTA NÃO CATALOGADA</small><h1>AR DE FORA</h1><p>Você encontrou uma passagem. Atrás de você, as lâmpadas continuam zumbindo.</p><div class="summary"><span>Tempo <b>${time}</b></span><span>Salas descobertas <b>${this.game?.discovered.size ?? 0}/7</b></span><span>Vida restante <b>${Math.round(this.game?.stats.health ?? 0)}%</b></span></div><button class="primary" data-action="menu">Encerrar registro</button></section></main>`;
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
      if (document.hidden && this.game?.status === 'exploring') this.game.pause(true);
      else if (!document.hidden && this.game?.status === 'paused') this.game.pause(false);
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
      case 'new-game': this.beginNewGame(); break;
      case 'continue': this.continueGame(); break;
      case 'menu': this.screen = 'menu'; this.game = null; this.inventoryOpen = false; this.audio.play('click'); break;
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
      case 'resume': this.game?.pause(false); this.audio.play('click'); break;
      case 'dev-toggle': this.devPanelOpen = !this.devPanelOpen; break;
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

  private beginNewGame(): void {
    const data = this.currentGameData();
    this.items = data.items;
    this.levelName = data.levelName;
    this.game = new Game(undefined, Math.random, data.world, undefined, data.items, data.entities);
    this.screen = 'game';
    this.inventoryOpen = false;
    this.focusedItem = null;
    this.seenAttackNonce = 0;
    this.dangerSoundTier = 0;
    this.nextDangerSoundAt = 0;
    this.audio.resetScheduling();
    this.persist();
    this.audio.play('step');
    this.syncMusic();
  }

  private continueGame(): void {
    if (!this.save.game) return;
    const data = this.currentGameData();
    this.items = data.items;
    this.levelName = data.levelName;
    this.game = new Game(this.save.game, Math.random, data.world, undefined, data.items, data.entities);
    this.screen = 'game';
    this.inventoryOpen = false;
    this.dangerSoundTier = 0;
    this.nextDangerSoundAt = 0;
    this.audio.resetScheduling();
    this.audio.play('step');
    this.syncMusic();
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
    if (thirst <= 25) this.audio.maybePlaySample(FX_THIRST_LOW);
    else if (thirst <= 50) this.audio.maybePlaySample(FX_THIRST);
    if (hunger <= 25) this.audio.maybePlaySample(FX_HUNGER_LOW);
    else if (hunger <= 50) this.audio.maybePlaySample(FX_HUNGER);
    if (health <= 30) this.audio.maybePlaySample(FX_LOW_HEALTH);
    if (game.anxietyLevel !== 'calm') this.audio.maybePlaySample(FX_ANXIETY, { pan: Math.random() * 1.2 - 0.6 });
    if (game.danger >= 40) this.audio.maybePlaySample(FX_SCREAM, { pan: Math.random() * 1.6 - 0.8 });
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
    return isLevelZero(this.levelName, room?.code, room?.image);
  }

  private handleInput(input: HTMLInputElement): void {
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
      if (this.screen === 'game' && this.game && (this.game.status === 'exploring' || this.game.status === 'paused')) {
        this.game.pause();
        this.audio.play('click');
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
    const screen = this.root.querySelector<HTMLElement>('.game-screen');
    if (screen) screen.className = `game-screen ${this.conditionClasses()}`;
    const blood = this.root.querySelector<HTMLElement>('.blood-overlay');
    if (blood) blood.dataset.bloodLevel = String(this.bloodLevel());
    const dangerReadout = this.root.querySelector<HTMLElement>('.dev-readout b');
    if (dangerReadout) dangerReadout.textContent = String(Math.round(this.game.danger));
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

  private updateInventoryFocus(): void {
    this.root.querySelectorAll<HTMLElement>('.item-slot[data-item]').forEach((slot) => slot.classList.toggle('focused', slot.dataset.item === this.focusedItem));
    const details = this.root.querySelector<HTMLElement>('.item-details');
    if (details) details.innerHTML = this.itemDetailsTemplate(this.focusedItem);
  }

  private persist(): void {
    if (!this.game || this.game.status === 'gameover') return;
    this.save.game = this.game.toSave();
    this.save.updatedAt = new Date().toISOString();
    this.persistSave();
  }

  private persistSave(): void { this.saves.save(this.save); }

  private clearSave(): void {
    if (!window.confirm('Apagar todo o progresso e as configurações salvas neste navegador?')) return;
    this.saves.clear();
    this.save = this.saves.load();
    this.audio.updatePreferences(this.save.preferences);
    this.game = null;
    this.inventoryOpen = false;
    this.screen = 'menu';
  }

  private currentGameData() {
    const project = new EditorProject();
    return {
      levelName: project.activeLevel.name,
      world: levelToWorld(project.activeLevel),
      items: itemsToRuntime(project.data.items),
      entities: entitiesToRuntime(project.data.entities),
    };
  }

  private bloodLevel(): number {
    const health = this.game?.stats.health ?? 100;
    return health <= 25 ? 3 : health <= 50 ? 2 : health <= 75 ? 1 : 0;
  }

  private conditionClasses(): string {
    if (!this.game) return '';
    const { thirst, hunger } = this.game.stats;
    return [
      thirst <= 10 ? 'thirst-critical' : thirst <= 30 ? 'thirst-low' : '',
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
