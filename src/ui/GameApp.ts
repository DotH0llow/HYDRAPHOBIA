import { ENEMY_CONFIG } from '../config/enemyConfig';
import { LAST_NIGHT, NIGHT_CONFIG } from '../config/nightConfig';
import { Game } from '../core/Game';
import { GameLoop } from '../core/GameLoop';
import { AudioSystem } from '../systems/AudioSystem';
import { SaveSystem } from '../systems/SaveSystem';
import type { EnemyId, RoomId, SaveData, Screen, Side } from '../types';

const ROOMS: Array<{ id: RoomId; label: string; mark: string }> = [
  { id: 'courtyard', label: 'Pátio interno', mark: 'I' },
  { id: 'chapel', label: 'Capela abandonada', mark: 'II' },
  { id: 'armory', label: 'Arsenal', mark: 'III' },
  { id: 'dungeon', label: 'Masmorra', mark: 'IV' },
  { id: 'westCorridor', label: 'Corredor oeste', mark: 'V' },
  { id: 'eastCorridor', label: 'Corredor leste', mark: 'VI' },
];

const ROOM_TEXT: Partial<Record<RoomId, string>> = {
  courtyard: 'A chuva apaga pegadas no pátio. Gárgulas vigiam as galerias vazias.',
  chapel: 'Bancos apodrecidos apontam para um altar que ninguém ousa nomear.',
  armory: 'Lâminas enferrujadas pendem como dentes nas paredes.',
  dungeon: 'Correntes balançam sob a terra, embora não haja vento.',
  westCorridor: 'Pedra, ferro e o eco de passos cada vez mais próximos.',
  eastCorridor: 'O véu de uma sombra roça os arcos do corredor.',
};

export class GameApp {
  private screen: Screen = 'menu';
  private selectedNight = 1;
  private game: Game | null = null;
  private loop: GameLoop;
  private readonly saveSystem = new SaveSystem();
  private save: SaveData;
  private readonly audio: AudioSystem;
  private lastRender = 0;
  private forceRender = true;
  private showDebug = false;
  private renderedScreen: Screen | null = null;
  private renderedStructure = '';

  constructor(private readonly root: HTMLElement) {
    this.save = this.saveSystem.load();
    this.selectedNight = this.save.unlockedNight;
    this.audio = new AudioSystem(this.save.preferences);
    this.loop = new GameLoop((delta) => this.update(delta), () => this.render());
    this.bindGlobalEvents();
  }

  start(): void { this.render(true); this.loop.start(); }

  private update(delta: number): void {
    if (!this.game) return;
    const before = this.game.status;
    this.game.update(delta);
    if (before !== this.game.status) {
      if (this.game.status === 'victory') {
        this.audio.play('victory');
        this.save = this.saveSystem.completeNight(this.save, this.game.night, this.game.energy.value);
        this.screen = this.game.night === LAST_NIGHT ? 'final' : 'victory';
      } else if (this.game.status === 'defeat') {
        this.audio.play('jumpscare');
        this.screen = 'defeat';
      }
      this.forceRender = true;
    }
  }

  private render(immediate = false): void {
    const now = performance.now();
    if (!immediate && !this.forceRender && now - this.lastRender < 100) return;
    this.lastRender = now;
    const forced = this.forceRender;
    this.forceRender = false;
    document.documentElement.dataset.motion = this.save.preferences.reducedMotion ? 'reduced' : 'full';
    document.documentElement.dataset.flashes = this.save.preferences.reducedFlashes ? 'reduced' : 'full';
    const structure = this.gameStructure();
    const mustRebuild = forced || this.renderedScreen !== this.screen || structure !== this.renderedStructure;
    if (mustRebuild) {
      this.root.innerHTML = this.screenTemplate();
      this.renderedScreen = this.screen;
      this.renderedStructure = structure;
    } else if (this.screen === 'game') {
      this.updateGameReadouts();
    }
  }

  private gameStructure(): string {
    if (this.screen !== 'game' || !this.game) return this.screen;
    const state = this.game.snapshot();
    return JSON.stringify({
      screen: this.screen,
      status: state.status,
      mirror: state.mirrorOpen,
      room: state.selectedRoom,
      light: state.lightActive,
      gates: [state.gates.west.state, state.gates.east.state],
      bell: state.bellReady,
      empty: state.energy <= 0,
      enemies: state.enemies.map(({ id, state: enemyState, room, visible, threat }) => [id, enemyState, room, visible, threat]),
      debug: this.showDebug,
    });
  }

  private updateGameReadouts(): void {
    if (!this.game) return;
    const state = this.game.snapshot();
    const energy = Math.round(state.energy);
    const text = (selector: string, value: string): void => {
      const element = this.root.querySelector<HTMLElement>(selector);
      if (element) element.textContent = value;
    };
    text('.clock strong', state.hour);
    text('.energy-panel strong', `${energy}%`);
    text('.energy-panel small', `Uso ${this.usagePips()}`);
    text('.danger-message', state.lastDanger || 'A torre escuta com você.');
    const clockBar = this.root.querySelector<HTMLElement>('.clock i');
    const energyBar = this.root.querySelector<HTMLElement>('.energy-track i');
    if (clockBar) clockBar.style.setProperty('--progress', String(state.elapsed / state.duration));
    if (energyBar) energyBar.style.width = `${energy}%`;
    (['west', 'east'] as const).forEach((side) => {
      this.root.querySelector<HTMLElement>(`.gate-${side} .iron-gate`)?.style.setProperty('--closed', String(state.gates[side].progress));
    });
    if (!state.bellReady && state.night >= 3) text('.bell-action small', `${Math.ceil(state.bellCooldown)}s`);
  }

  private screenTemplate(): string {
    switch (this.screen) {
      case 'menu': return this.menuTemplate();
      case 'intro': return this.introTemplate();
      case 'game': return this.gameTemplate();
      case 'victory': return this.victoryTemplate();
      case 'defeat': return this.defeatTemplate();
      case 'final': return this.finalTemplate();
      case 'settings': return this.settingsTemplate();
      case 'credits': return this.creditsTemplate();
    }
  }

  private menuTemplate(): string {
    const buttons = Array.from({ length: LAST_NIGHT }, (_, index) => index + 1).map((night) => {
      const locked = night > this.save.unlockedNight;
      const complete = this.save.completedNights.includes(night);
      return `<button class="night-seal ${complete ? 'complete' : ''}" data-action="select-night" data-night="${night}" ${locked ? 'disabled' : ''} aria-label="Noite ${night}${locked ? ', bloqueada' : ''}">
        <span>${locked ? '◇' : night}</span><small>${locked ? 'Selada' : complete ? 'Concluída' : 'Disponível'}</small>
      </button>`;
    }).join('');
    return `<main class="screen menu-screen">
      <div class="rain" aria-hidden="true"></div><div class="vignette" aria-hidden="true"></div>
      <section class="menu-card">
        <p class="eyebrow">Uma vigília em seis badaladas</p>
        <h1>A Última<br><em>Vigília</em></h1>
        <p class="menu-lore">A torre ainda respira. Você é tudo o que resta entre o amanhecer e aquilo que percorre os corredores.</p>
        <div class="night-row" aria-label="Seleção de noites">${buttons}</div>
        <div class="menu-actions">
          <button class="primary carved" data-action="open-intro">${this.save.completedNights.length ? 'Continuar a vigília' : 'Assumir o posto'}</button>
          <button class="text-button" data-action="settings">Configurações</button>
          <button class="text-button" data-action="credits">Créditos</button>
        </div>
        <p class="selected-night">Noite ${this.selectedNight} · ${NIGHT_CONFIG[this.selectedNight]!.title}</p>
      </section>
      <div class="tower-silhouette" aria-hidden="true"><div class="tower-window"></div></div>
      <footer class="menu-footer">Recomendado: fones de ouvido · O progresso é salvo neste navegador</footer>
    </main>`;
  }

  private introTemplate(): string {
    const night = NIGHT_CONFIG[this.selectedNight]!;
    return `<main class="screen parchment-screen">
      <section class="parchment">
        <button class="close-x" data-action="menu" aria-label="Voltar">×</button>
        <p class="eyebrow">Noite ${this.selectedNight}</p>
        <h2>${night.title}</h2>
        <blockquote>“${night.omen}”</blockquote>
        <p>Ao soar da meia-noite, o selo da torre desperta. A energia arcana é finita; cada portão, luz e visão pelo espelho cobra seu tributo.</p>
        <div class="instruction-grid">
          ${night.tutorial.map((line, index) => `<article><span>${index + 1}</span><p>${line}</p></article>`).join('')}
        </div>
        <div class="key-guide"><kbd>A</kbd> portão oeste <kbd>D</kbd> portão leste <kbd>M</kbd> espelho <kbd>B</kbd> sino <kbd>Esc</kbd> fechar/pausar</div>
        <button class="primary carved" data-action="start-night">Acender as velas</button>
      </section>
    </main>`;
  }

  private gameTemplate(): string {
    if (!this.game) return '';
    const state = this.game.snapshot();
    const energyPercent = Math.round(state.energy);
    const danger = state.enemies.some((enemy) => enemy.threat >= 0.75);
    const paused = state.status === 'paused';
    return `<main class="screen game-screen ${danger ? 'danger' : ''}">
      <div class="game-world">
        ${state.mirrorOpen ? this.mirrorTemplate() : this.towerTemplate()}
      </div>
      <header class="hud-top">
        <div class="night-plate"><span>Noite</span><strong>${state.night}</strong></div>
        <div class="clock"><small>até o amanhecer</small><strong>${state.hour}</strong><i style="--progress:${state.elapsed / state.duration}"></i></div>
        <button class="icon-button" data-action="pause" aria-label="Pausar">Ⅱ</button>
      </header>
      <aside class="energy-panel">
        <span>Energia arcana</span><strong>${energyPercent}%</strong>
        <div class="energy-track"><i style="width:${energyPercent}%"></i></div>
        <small>Uso ${this.usagePips()}</small>
      </aside>
      <div class="danger-message" role="status">${state.lastDanger || 'A torre escuta com você.'}</div>
      ${this.controlsTemplate()}
      ${paused ? this.pauseTemplate() : ''}
      ${this.debugTemplate()}
    </main>`;
  }

  private towerTemplate(): string {
    const state = this.game!.snapshot();
    return `<section class="tower-view ${state.lightActive ? `light-${state.lightActive}` : ''}">
      <div class="stone-wall" aria-hidden="true"></div>
      ${this.gateTemplate('west')}
      <div class="central-alcove">
        <div class="rose-window" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <div class="mirror-frame" data-action="mirror" role="button" tabindex="0" aria-label="Abrir espelho de vidência">
          <div class="mirror-glass"><span>◈</span><small>ESPELHO DE VIDÊNCIA</small></div>
        </div>
        <div class="altar"><div class="candle c1"></div><div class="bell-object" data-action="bell" aria-hidden="true">♢</div><div class="candle c2"></div></div>
      </div>
      ${this.gateTemplate('east')}
      <div class="floor-runes" aria-hidden="true">ᛉ　ᚾ　ᛟ　ᚱ　ᛇ</div>
      <div class="fog fog-one" aria-hidden="true"></div><div class="fog fog-two" aria-hidden="true"></div>
    </section>`;
  }

  private gateTemplate(side: Side): string {
    const state = this.game!.snapshot();
    const gate = state.gates[side];
    const near = state.enemies.find((enemy) => ENEMY_CONFIG[enemy.id].side === side && enemy.threat >= 0.75);
    const revealed = near && (state.lightActive === side || near.state === 'AT_GATE');
    const label = side === 'west' ? 'Oeste' : 'Leste';
    return `<div class="gate-area gate-${side}">
      <span class="arch-label">PORTÃO ${label.toUpperCase()}</span>
      <div class="archway ${revealed ? 'presence' : ''}">
        <div class="enemy-shadow ${near?.id ?? ''}">${revealed ? this.enemySigil(near!.id) : ''}</div>
        <div class="iron-gate state-${gate.state.toLowerCase()}" style="--closed:${gate.progress}">
          ${Array.from({ length: 7 }, () => '<i></i>').join('')}
        </div>
      </div>
      <button class="gate-lever" data-action="gate" data-side="${side}" ${gate.state === 'UNAVAILABLE' ? 'disabled' : ''}>
        <span class="lever-light"></span><b>${this.gateLabel(gate.state)}</b><small>Tecla ${side === 'west' ? 'A' : 'D'}</small>
      </button>
      <button class="light-button" data-action="light" data-side="${side}" ${state.energy <= 0 ? 'disabled' : ''}>${state.lightActive === side ? 'Apagar runa' : 'Acender runa'}</button>
    </div>`;
  }

  private mirrorTemplate(): string {
    const state = this.game!.snapshot();
    const room = ROOMS.find((item) => item.id === state.selectedRoom) ?? ROOMS[0]!;
    const occupants = state.enemies.filter((enemy) => enemy.room === room.id && enemy.visible);
    const movement = state.enemies.some((enemy) => enemy.room === room.id && !enemy.visible);
    return `<section class="mirror-view">
      <div class="mirror-noise" aria-hidden="true"></div>
      <div class="scry-scene room-${room.id}">
        <div class="scene-architecture"><i></i><i></i><i></i></div>
        <div class="scene-moon"></div>
        <div class="scene-fog"></div>
        ${occupants.map((enemy) => `<div class="scry-enemy ${enemy.id}">${this.enemySigil(enemy.id)}<span>${enemy.name}</span></div>`).join('')}
        ${movement ? '<div class="trace">algo ocultou-se da visão</div>' : ''}
        <div class="room-caption"><small>VISÃO ${room.mark}</small><h2>${room.label}</h2><p>${ROOM_TEXT[room.id]}</p></div>
      </div>
      <aside class="mirror-map">
        <p>Mapa do castelo</p>
        <div class="map-lines" aria-hidden="true"></div>
        ${ROOMS.map((item) => `<button class="map-node ${item.id === room.id ? 'active' : ''}" data-action="room" data-room="${item.id}"><b>${item.mark}</b><span>${item.label}</span></button>`).join('')}
      </aside>
      <button class="mirror-close" data-action="mirror">Fechar espelho <kbd>Esc</kbd></button>
      <div class="scry-status">${occupants.length ? 'PRESENÇA DETECTADA' : movement ? 'INTERFERÊNCIA' : 'NENHUM SINAL'}</div>
    </section>`;
  }

  private controlsTemplate(): string {
    const state = this.game!.snapshot();
    const bellLocked = state.night < 3;
    return `<nav class="action-bar" aria-label="Controles da vigília">
      <button data-action="gate" data-side="west" ${state.gates.west.state === 'UNAVAILABLE' ? 'disabled' : ''}><span>◀</span><b>Portão oeste</b><small>${this.gateLabel(state.gates.west.state)}</small></button>
      <button class="mirror-action ${state.mirrorOpen ? 'active' : ''}" data-action="mirror" ${state.energy <= 0 ? 'disabled' : ''}><span>◈</span><b>${state.mirrorOpen ? 'Baixar espelho' : 'Erguer espelho'}</b><small>Visões consomem energia</small></button>
      <button class="bell-action ${state.bellReady ? 'ready' : ''}" data-action="bell" ${bellLocked || !state.bellReady || state.energy <= 0 ? 'disabled' : ''}><span>♢</span><b>Sino ritual</b><small>${bellLocked ? 'Selado até a Noite 3' : state.bellReady ? 'Pronto para soar' : `${Math.ceil(state.bellCooldown)}s`}</small></button>
      <button data-action="gate" data-side="east" ${state.gates.east.state === 'UNAVAILABLE' ? 'disabled' : ''}><span>▶</span><b>Portão leste</b><small>${this.gateLabel(state.gates.east.state)}</small></button>
    </nav>`;
  }

  private pauseTemplate(): string {
    return `<div class="modal-layer"><section class="pause-card"><p class="eyebrow">A chama permanece imóvel</p><h2>Vigília pausada</h2><p>A simulação também pausa quando esta aba fica oculta.</p><button class="primary carved" data-action="pause">Retomar</button><button class="text-button" data-action="restart">Reiniciar noite</button><button class="text-button" data-action="menu">Abandonar o posto</button></section></div>`;
  }

  private victoryTemplate(): string {
    const state = this.game?.snapshot();
    return `<main class="screen result-screen dawn"><div class="sunrise"></div><section class="result-card"><p class="eyebrow">Os sinos do vale respondem</p><h1>06:00</h1><h2>Você sobreviveu à Noite ${this.selectedNight}</h2><div class="result-stats"><span>Energia restante <b>${Math.round(state?.energy ?? 0)}%</b></span><span>Próxima vigília <b>Desbloqueada</b></span></div><button class="primary carved" data-action="next-night">Preparar a próxima noite</button><button class="text-button" data-action="menu">Voltar ao menu</button></section></main>`;
  }

  private defeatTemplate(): string {
    const id = this.game?.defeatBy ?? 'hollowKnight';
    const enemy = ENEMY_CONFIG[id];
    return `<main class="screen result-screen death"><div class="jumpscare ${id}">${this.enemySigil(id)}<div class="slash"></div></div><section class="result-card defeat-card"><p class="eyebrow">A vigília terminou</p><h1>${enemy.name}</h1><p>${this.defeatExplanation(id)}</p><button class="primary carved" data-action="restart">Tentar novamente</button><button class="text-button" data-action="menu">Voltar ao menu</button></section></main>`;
  }

  private finalTemplate(): string {
    return `<main class="screen result-screen final-screen"><div class="sunrise"></div><section class="parchment final-letter"><p class="eyebrow">A última manhã</p><h1>A Vigília está cumprida</h1><p>Quando o sexto sino ecoou, o castelo não despertou. Pela primeira vez em cem anos, as sombras recuaram antes da luz.</p><p>Sobre o altar, onde antes havia apenas pó, você encontrou uma única pena branca — e a certeza de que alguma coisa, em algum lugar, ainda se lembrava do seu nome.</p><blockquote>“Toda noite termina. Nem todo sentinela permanece para vê-la.”</blockquote><button class="primary carved" data-action="menu">Guardar a chave da torre</button></section></main>`;
  }

  private settingsTemplate(): string {
    const prefs = this.save.preferences;
    return `<main class="screen parchment-screen"><section class="parchment compact"><button class="close-x" data-action="menu">×</button><p class="eyebrow">Ajustes do relicário</p><h2>Configurações</h2><label class="setting"><span>Volume <b>${Math.round(prefs.volume * 100)}%</b></span><input type="range" min="0" max="1" step="0.05" value="${prefs.volume}" data-setting="volume"></label><label class="toggle"><input type="checkbox" data-setting="muted" ${prefs.muted ? 'checked' : ''}><span></span>Silenciar todos os sons</label><label class="toggle"><input type="checkbox" data-setting="reducedMotion" ${prefs.reducedMotion ? 'checked' : ''}><span></span>Reduzir movimento</label><label class="toggle"><input type="checkbox" data-setting="reducedFlashes" ${prefs.reducedFlashes ? 'checked' : ''}><span></span>Reduzir flashes intensos</label><p class="settings-note">O áudio começa somente após sua primeira interação.</p><button class="primary carved" data-action="menu">Concluir</button></section></main>`;
  }

  private creditsTemplate(): string {
    return `<main class="screen parchment-screen"><section class="parchment compact"><button class="close-x" data-action="menu">×</button><p class="eyebrow">Créditos</p><h2>Feito para a escuridão</h2><p><strong>A Última Vigília</strong> é uma obra original em TypeScript, HTML, CSS e Web Audio API.</p><p>Visuais são composições próprias em CSS e SVG. Todo áudio é sintetizado em tempo real, sem arquivos ou obras de terceiros.</p><p>Referências conceituais de arquitetura: Night Guard e Cupcakes Framework (MIT). Nenhum código ou asset foi incorporado.</p><button class="primary carved" data-action="menu">Retornar</button></section></main>`;
  }

  private debugTemplate(): string {
    if (!import.meta.env.DEV) return '';
    if (!this.showDebug) return '<button class="debug-toggle" data-action="debug-toggle">DEBUG</button>';
    const state = this.game!.snapshot();
    return `<aside class="debug-panel"><button data-action="debug-toggle">×</button><b>Ferramentas de vigia</b><div>Energia ${state.energy.toFixed(1)} · ${state.hour}</div><div class="debug-buttons"><button data-action="debug-energy">+ Energia</button><button data-action="debug-time">+ 1 hora</button><button data-action="debug-speed">Velocidade ×5</button><button data-action="restart">Reiniciar</button></div>${state.enemies.map((enemy) => `<p><strong>${enemy.name}</strong><br>${enemy.state} · ${enemy.room}<button data-action="debug-attack" data-enemy="${enemy.id}">Atacar</button></p>`).join('')}<small>${state.eventLog.join('<br>')}</small></aside>`;
  }

  private bindGlobalEvents(): void {
    this.root.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (!target || target.matches(':disabled')) return;
      void this.audio.unlock();
      this.handleAction(target.dataset.action ?? '', target.dataset);
    });
    this.root.addEventListener('input', (event) => this.handleSetting(event.target as HTMLInputElement));
    window.addEventListener('keydown', (event) => this.handleKey(event));
    document.addEventListener('visibilitychange', () => {
      this.game?.setPaused(document.hidden);
      this.forceRender = true;
    });
  }

  private handleAction(action: string, data: DOMStringMap): void {
    const click = () => this.audio.play('click');
    switch (action) {
      case 'select-night': this.selectedNight = Number(data.night); click(); break;
      case 'open-intro': this.screen = 'intro'; click(); break;
      case 'start-night': this.startNight(); break;
      case 'menu': this.game = null; this.screen = 'menu'; click(); break;
      case 'settings': this.screen = 'settings'; click(); break;
      case 'credits': this.screen = 'credits'; click(); break;
      case 'gate': this.useGate(data.side as Side); break;
      case 'light': this.game?.setLight(data.side as Side); click(); break;
      case 'mirror': if (this.game?.toggleMirror()) this.audio.play('mirror'); break;
      case 'room': this.game?.selectRoom(data.room as RoomId); this.audio.play('mirror'); break;
      case 'bell': this.useBell(); break;
      case 'pause': this.game?.togglePause(); click(); break;
      case 'restart': this.startNight(); break;
      case 'next-night': this.selectedNight = Math.min(LAST_NIGHT, this.selectedNight + 1); this.screen = 'intro'; click(); break;
      case 'debug-toggle': this.showDebug = !this.showDebug; break;
      case 'debug-energy': this.game?.debugSetEnergy(100); break;
      case 'debug-time': if (this.game) this.game.debugAdvance(this.game.time.duration / 6); break;
      case 'debug-speed': this.loop.setSpeed(5); break;
      case 'debug-attack': this.game?.debugForceEnemy(data.enemy as EnemyId, 'ATTACKING', this.attackRoom(data.enemy as EnemyId)); break;
    }
    this.forceRender = true;
    this.render(true);
  }

  private startNight(): void {
    this.game = new Game(this.selectedNight);
    this.bindGameAudio(this.game);
    this.game.start();
    this.screen = 'game';
    this.audio.play('mirror');
  }

  private bindGameAudio(game: Game): void {
    game.events.on('enemy:moved', ({ cue, room }) => this.audio.play(cue as 'metal' | 'whisper' | 'chant', room.includes('west') ? -0.8 : room.includes('east') ? 0.8 : 0));
    game.events.on('enemy:danger', () => this.audio.play('danger'));
    game.events.on('gate:changed', ({ side }) => this.audio.play('gate', side === 'west' ? -0.8 : 0.8));
  }

  private useGate(side: Side): void { if (this.game?.toggleGate(side)) this.audio.play('gate', side === 'west' ? -0.8 : 0.8); }
  private useBell(): void { const result = this.game?.ringBell(); if (result !== null && result !== undefined) this.audio.play('bell'); }

  private handleKey(event: KeyboardEvent): void {
    if (this.screen !== 'game' || !this.game || event.repeat) return;
    const key = event.key.toLowerCase();
    if (key === 'a') this.useGate('west');
    else if (key === 'd') this.useGate('east');
    else if (key === 'm') { if (this.game.toggleMirror()) this.audio.play('mirror'); }
    else if (key === 'b') this.useBell();
    else if (key === 'escape') { if (this.game.mirrorOpen) { this.game.toggleMirror(); this.audio.play('mirror'); } else this.game.togglePause(); }
    else return;
    this.forceRender = true;
    this.render(true);
  }

  private handleSetting(input: HTMLInputElement): void {
    const key = input.dataset.setting as keyof SaveData['preferences'] | undefined;
    if (!key) return;
    if (key === 'volume') this.save.preferences.volume = Number(input.value);
    else this.save.preferences[key] = input.checked;
    this.saveSystem.save(this.save);
    this.audio.updatePreferences(this.save.preferences);
    this.forceRender = true;
  }

  private usagePips(): string {
    if (!this.game) return '◆';
    const state = this.game.snapshot();
    const usage = 1 + this.game.gates.closedCount() + Number(state.mirrorOpen) + Number(state.lightActive !== null);
    return `${'◆'.repeat(usage)}${'◇'.repeat(Math.max(0, 5 - usage))}`;
  }

  private gateLabel(state: string): string {
    return ({ OPEN: 'Aberto', CLOSED: 'Fechado', CLOSING: 'Fechando…', OPENING: 'Abrindo…', UNAVAILABLE: 'Sem energia' } as Record<string, string>)[state] ?? state;
  }

  private enemySigil(id: EnemyId): string {
    if (id === 'hollowKnight') return '<div class="knight-shape"><i></i><b>†</b></div>';
    if (id === 'veiledWidow') return '<div class="widow-shape"><i></i><b></b></div>';
    return '<div class="monk-shape"><i>ᛉ</i><b></b></div>';
  }

  private defeatExplanation(id: EnemyId): string {
    if (id === 'hollowKnight') return 'O portão oeste estava aberto quando os passos de ferro terminaram diante da torre.';
    if (id === 'veiledWidow') return 'Os sussurros chegaram ao corredor leste, mas o portão permaneceu desprotegido.';
    return 'O cântico cessou dentro da torre. O sino não foi tocado durante o ritual de aproximação.';
  }

  private attackRoom(id: EnemyId): RoomId { return id === 'hollowKnight' ? 'westGate' : id === 'veiledWidow' ? 'eastGate' : 'tower'; }
}
