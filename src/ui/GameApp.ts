import { ITEMS } from '../config/world';
import { Game } from '../core/Game';
import { AudioSystem } from '../systems/AudioSystem';
import { SaveSystem } from '../systems/SaveSystem';
import type { Direction, EncounterAction, HotspotId, ItemId, Preferences, SaveData, Screen } from '../types';

export class GameApp {
  private screen: Screen = 'menu';
  private game: Game | null = null;
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
  private jumpscareEntity = 'watcher';
  private seenAttackNonce = 0;

  constructor(private readonly root: HTMLElement) {
    this.save = this.saves.load();
    this.audio = new AudioSystem(this.save.preferences);
    this.bindEvents();
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
        this.triggerJumpscare();
        this.persist();
      }
      if (this.game.status === 'gameover' && Date.now() >= this.jumpscareUntil) { this.screen = 'gameover'; this.forcePaint = true; }
      if (this.game.status === 'escaped') { this.screen = 'escaped'; this.audio.play('escape'); this.save.game = null; this.persistSave(); this.forcePaint = true; }
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
    } else if (this.screen === 'game') this.updateReadouts();
  }

  private structureKey(): string {
    if (this.screen !== 'game' || !this.game) return `${this.screen}:${this.inventoryOpen}:${this.focusedItem ?? ''}:${JSON.stringify(this.save.preferences)}`;
    return JSON.stringify({
      screen: this.screen,
      room: this.game.position,
      status: this.game.status,
      encounter: this.game.encounter?.id,
      inventory: this.game.inventory,
      inventoryOpen: this.inventoryOpen,
      focusedItem: this.focusedItem,
      selectedItem: this.game.selectedItem,
      flags: this.game.flags,
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
        <h1>LIMIAR</h1>
        <p class="subtitle">Você não deveria ter atravessado aquela parede.</p>
        <nav class="menu-actions">
          <button class="primary" data-action="new-game"><span>01</span>Novo jogo</button>
          <button data-action="continue" ${this.save.game ? '' : 'disabled'}><span>02</span>Continuar</button>
          <button data-action="settings"><span>03</span>Configurações</button>
          <button data-action="exit"><span>04</span>Sair</button>
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
    const hotspotMarkup = room.hotspots.map((hotspot) => {
      const used = hotspot.once && this.game!.flags[`hotspot:${room.id}:${hotspot.id}`];
      if (used) return '';
      return `<button class="hotspot" data-action="hotspot" data-hotspot="${hotspot.id}" style="--x:${hotspot.x}%;--y:${hotspot.y}%;--w:${hotspot.width}%;--h:${hotspot.height}%" aria-label="${hotspot.label}"><span>${hotspot.label}</span></button>`;
    }).join('');
    return `<main class="game-screen ${this.game.status === 'paused' ? 'is-paused' : ''}">
      <section class="scene" aria-label="${room.name}">
        <img src="${room.image}" alt="${room.description}" />
        <div class="scene-grade"></div><div class="scene-noise"></div>
        ${hotspotMarkup}
      </section>
      <header class="game-header">
        <div class="room-id"><small>${room.code}</small><strong>${room.name}</strong></div>
        <div class="survival-bars">
          ${this.statBar('health', 'VIDA', this.game.stats.health)}
          ${this.statBar('hunger', 'FOME', this.game.stats.hunger)}
          ${this.statBar('thirst', 'SEDE', this.game.stats.thirst)}
        </div>
        <button class="pause-button" data-action="pause" aria-label="Pausar">Ⅱ</button>
      </header>
      <nav class="movement" aria-label="Movimentação">
        ${exits.map(([direction, exit]) => `<button class="move-${direction} ${exit.requires && !this.game!.flags[exit.requires] ? 'locked' : ''}" data-action="move" data-direction="${direction}" aria-label="${exit.label}"><i>${this.directionIcon(direction)}</i><span>${exit.label}</span></button>`).join('')}
      </nav>
      <div class="message-strip" role="status"><i></i><p>${this.game.message}</p></div>
      <button class="inventory-button ${this.game.selectedItem ? 'item-selected' : ''}" data-action="inventory"><span>▦</span><b>Inventário</b><small>${this.game.inventory.reduce((sum, item) => sum + item.quantity, 0)} itens</small></button>
      ${this.inventoryOpen ? this.inventoryTemplate() : ''}
      ${this.game.encounter ? this.encounterTemplate() : ''}
      ${this.game.status === 'paused' ? this.pauseTemplate() : ''}
      ${Date.now() < this.jumpscareUntil ? this.jumpscareTemplate() : ''}
    </main>`;
  }

  private statBar(key: string, label: string, value: number): string {
    const danger = value <= 25 ? 'danger' : value <= 50 ? 'warning' : '';
    return `<div class="stat ${danger}" data-stat="${key}"><span>${label}</span><b>${Math.round(value)}</b><div><i style="width:${value}%"></i></div></div>`;
  }

  private inventoryTemplate(): string {
    const game = this.game!;
    const slots = Array.from({ length: 12 }, (_, index) => game.inventory[index]);
    const focus = this.focusedItem ? ITEMS[this.focusedItem] : null;
    return `<div class="inventory-layer">
      <button class="inventory-dismiss" data-action="inventory" aria-label="Fechar inventário"></button>
      <aside class="inventory-panel">
        <header><div><small>ARQUIVO PESSOAL</small><h2>Inventário</h2></div><button data-action="inventory">×</button></header>
        <div class="inventory-grid">
          ${slots.map((entry, index) => entry
            ? `<button class="item-slot ${game.selectedItem === entry.id ? 'selected' : ''} ${this.focusedItem === entry.id ? 'focused' : ''}" data-action="focus-item" data-item="${entry.id}"><span>${ITEMS[entry.id].icon}</span><b>${ITEMS[entry.id].name}</b><em>${entry.quantity}</em></button>`
            : `<div class="item-slot empty"><small>${String(index + 1).padStart(2, '0')}</small></div>`).join('')}
        </div>
        <section class="item-details">
          ${focus && this.focusedItem ? `<div class="item-large">${focus.icon}</div><div><small>ITEM SELECIONADO</small><h3>${focus.name}</h3><p>${focus.description}</p><div class="item-actions"><button data-action="use-item" data-item="${this.focusedItem}">Usar</button><button data-action="examine-item" data-item="${this.focusedItem}">Examinar</button><button class="discard" data-action="discard-item" data-item="${this.focusedItem}">Descartar</button></div></div>` : '<p class="empty-details">Selecione um item para examinar ou utilizar.</p>'}
        </section>
      </aside>
    </div>`;
  }

  private encounterTemplate(): string {
    const encounter = this.game!.encounter!;
    return `<div class="encounter-layer ${encounter.id}">
      <img class="entity-image" src="/assets/entities/${encounter.id}.jpg" alt="${encounter.name} bloqueando o caminho" />
      <section class="encounter-card">
        <small>AMEAÇA // DECIDA AGORA</small><h2>${encounter.name}</h2>
        <p>${encounter.prompt}</p><em>${encounter.hint}</em>
        <div class="decision-timer"><i style="width:${(encounter.remaining / (encounter.id === 'watcher' ? 5 : 4.2)) * 100}%"></i></div>
        <div class="decision-buttons"><button data-action="encounter" data-choice="run">Correr</button><button data-action="encounter" data-choice="hide">Esconder-se</button></div>
      </section>
    </div>`;
  }

  private pauseTemplate(): string {
    return `<div class="modal-layer"><section class="simple-modal"><small>SIMULAÇÃO INTERROMPIDA</small><h2>Pausado</h2><p>O tempo, a fome e a sede estão congelados.</p><button class="primary" data-action="pause">Continuar</button><button data-action="settings">Configurações</button><button data-action="menu">Voltar ao menu</button></section></div>`;
  }

  private jumpscareTemplate(): string {
    return `<div class="jumpscare" style="--intensity:${this.save.preferences.jumpscareIntensity}" aria-label="Ataque repentino"><img src="/assets/entities/${this.jumpscareEntity}.jpg" alt="Entidade atacando" /><div class="jump-static"></div></div>`;
  }

  private settingsTemplate(): string {
    const p = this.save.preferences;
    return `<main class="settings-screen"><img src="/assets/scenes/corridor.jpg" alt="" /><div class="settings-shade"></div><section class="settings-panel"><small>CONFIGURAÇÃO DO REGISTRO</small><h1>Configurações</h1>${this.range('masterVolume', 'Volume geral', p.masterVolume)}${this.range('musicVolume', 'Ambiente / música', p.musicVolume)}${this.range('effectsVolume', 'Efeitos sonoros', p.effectsVolume)}${this.range('jumpscareIntensity', 'Intensidade dos sustos', p.jumpscareIntensity)}<button data-action="fullscreen">${document.fullscreenElement ? 'Sair da tela cheia' : 'Ativar tela cheia'}</button><button class="primary" data-action="settings-back">Voltar</button></section></main>`;
  }

  private range(key: keyof Preferences, label: string, value: number): string {
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
    this.root.addEventListener('input', (event) => this.handleSetting(event.target as HTMLInputElement));
    window.addEventListener('keydown', (event) => this.handleKey(event));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.game?.status === 'exploring') { this.game.pause(true); this.forcePaint = true; }
    });
  }

  private async handleAction(action: string, data: DOMStringMap): Promise<void> {
    switch (action) {
      case 'new-game': this.beginNewGame(); break;
      case 'continue': this.continueGame(); break;
      case 'menu': this.screen = 'menu'; this.game = null; this.inventoryOpen = false; this.audio.play('click'); break;
      case 'settings': this.screen = 'settings'; this.audio.play('click'); break;
      case 'settings-back': this.screen = this.game ? 'game' : 'menu'; this.audio.play('click'); break;
      case 'exit': window.close(); this.screen = 'exit'; break;
      case 'fullscreen': await this.toggleFullscreen(); break;
      case 'move': this.move(data.direction as Direction); break;
      case 'hotspot': this.interact(data.hotspot as HotspotId); break;
      case 'inventory': this.inventoryOpen = !this.inventoryOpen; if (!this.inventoryOpen) this.focusedItem = null; this.audio.play('click'); break;
      case 'focus-item': this.focusedItem = data.item as ItemId; this.audio.play('click'); break;
      case 'use-item': this.useItem(data.item as ItemId); break;
      case 'examine-item': this.game?.examineItem(data.item as ItemId); this.inventoryOpen = false; break;
      case 'discard-item': this.game?.discardItem(data.item as ItemId); this.focusedItem = null; this.persist(); break;
      case 'encounter': this.respond(data.choice as EncounterAction); break;
      case 'pause': this.game?.pause(); this.audio.play('click'); break;
    }
    this.forcePaint = true;
    this.render(true);
  }

  private beginNewGame(): void {
    this.game = new Game();
    this.screen = 'game';
    this.inventoryOpen = false;
    this.focusedItem = null;
    this.seenAttackNonce = 0;
    this.persist();
    this.audio.play('step');
  }

  private continueGame(): void {
    if (!this.save.game) return;
    this.game = new Game(this.save.game);
    this.screen = 'game';
    this.inventoryOpen = false;
    this.audio.play('step');
  }

  private move(direction: Direction): void {
    if (!this.game) return;
    const result = this.game.navigate(direction);
    this.audio.play(result.changed ? 'step' : 'locked');
    if (this.game.status === 'encounter') this.audio.play('entity');
    this.persist();
  }

  private interact(id: HotspotId): void {
    if (!this.game) return;
    const result = this.game.interact(id);
    this.audio.play(result.pickup ? 'pickup' : result.changed ? 'use' : 'click');
    this.persist();
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
    const entity = this.game.encounter?.id ?? 'watcher';
    const result = this.game.respondToEncounter(action);
    if (result.attack) { this.jumpscareEntity = entity; this.seenAttackNonce = this.game.attackNonce; this.triggerJumpscare(); }
    else this.audio.play('step');
    this.persist();
  }

  private triggerJumpscare(): void {
    this.jumpscareUntil = Date.now() + 850 + this.save.preferences.jumpscareIntensity * 500;
    this.audio.play('jumpscare');
    this.forcePaint = true;
  }

  private handleSetting(input: HTMLInputElement): void {
    const key = input.dataset.setting as keyof Preferences | undefined;
    if (!key) return;
    this.save.preferences[key] = Number(input.value);
    this.audio.updatePreferences(this.save.preferences);
    this.persistSave();
    const value = input.closest('label')?.querySelector('b');
    if (value) value.textContent = `${Math.round(Number(input.value) * 100)}%`;
  }

  private handleKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (this.inventoryOpen) { this.inventoryOpen = false; this.focusedItem = null; }
      else if (this.screen === 'game') this.game?.pause();
      this.forcePaint = true; this.render(true);
      return;
    }
    if (this.screen !== 'game' || this.inventoryOpen || this.game?.status !== 'exploring') return;
    const directions: Record<string, Direction> = { ArrowUp: 'forward', w: 'forward', ArrowDown: 'back', s: 'back', ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right' };
    const direction = directions[event.key];
    if (direction) { this.move(direction); this.forcePaint = true; this.render(true); }
    if (event.key.toLowerCase() === 'i') { this.inventoryOpen = true; this.forcePaint = true; this.render(true); }
  }

  private updateReadouts(): void {
    if (!this.game) return;
    (['health', 'hunger', 'thirst'] as const).forEach((key) => {
      const stat = this.root.querySelector<HTMLElement>(`[data-stat="${key}"]`);
      const value = this.game!.stats[key];
      const number = stat?.querySelector<HTMLElement>('b');
      const bar = stat?.querySelector<HTMLElement>('i');
      if (number) number.textContent = String(Math.round(value));
      if (bar) bar.style.width = `${value}%`;
      stat?.classList.toggle('danger', value <= 25);
      stat?.classList.toggle('warning', value > 25 && value <= 50);
    });
    if (this.game.encounter) {
      const timer = this.root.querySelector<HTMLElement>('.decision-timer i');
      if (timer) timer.style.width = `${(this.game.encounter.remaining / (this.game.encounter.id === 'watcher' ? 5 : 4.2)) * 100}%`;
    }
  }

  private persist(): void {
    if (!this.game || this.game.status === 'gameover') return;
    this.save.game = this.game.toSave();
    this.save.updatedAt = new Date().toISOString();
    this.persistSave();
  }

  private persistSave(): void { this.saves.save(this.save); }

  private async toggleFullscreen(): Promise<void> {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
    this.forcePaint = true;
  }

  private directionIcon(direction: Direction): string {
    return ({ forward: '↑', back: '↓', left: '←', right: '→' } as const)[direction];
  }

  private formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    return `${String(minutes).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  }
}
