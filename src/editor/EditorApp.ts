import { ITEMS } from '../config/world';
import { Game } from '../core/Game';
import { AudioSystem } from '../systems/AudioSystem';
import { DEFAULT_PREFERENCES } from '../systems/SaveSystem';
import type { EncounterAction, ItemId } from '../types';
import { EditorProject } from './EditorProject';
import { levelToWorld } from './mapAdapter';
import { IMAGE_LIBRARY, ITEM_OPTIONS, type EditorConnection, type EditorHotspot, type EditorRoom } from './types';

type Gesture =
  | { type: 'room'; roomId: string; startX: number; startY: number; originX: number; originY: number }
  | { type: 'pan'; startX: number; startY: number; originX: number; originY: number }
  | { type: 'hotspot'; roomId: string; hotspotId: string; resize: boolean; startX: number; startY: number; origin: { x: number; y: number; width: number; height: number }; rect: DOMRect };

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export class EditorApp {
  private readonly project = new EditorProject();
  private readonly audio = new AudioSystem(DEFAULT_PREFERENCES);
  private selectedRoomId = this.project.activeLevel.startRoomId;
  private selectedHotspotId: string | null = null;
  private selectedConnectionId: string | null = null;
  private hotspotEditorOpen = false;
  private pan = { x: 80, y: 60 };
  private zoom = 0.82;
  private gesture: Gesture | null = null;
  private connectionSource: string | null = null;
  private connectionPointer = { x: 0, y: 0 };
  private testGame: Game | null = null;
  private testMode = false;
  private testInventoryOpen = false;
  private testJumpscareUntil = 0;
  private testAttackNonce = 0;
  private lastFrame = performance.now();
  private lastTestKey = '';

  constructor(private readonly root: HTMLElement) { this.bindEvents(); }

  start(): void {
    this.render();
    requestAnimationFrame(this.tick);
  }

  private get selectedRoom(): EditorRoom | undefined { return this.project.findRoom(this.selectedRoomId); }

  private render(): void {
    this.root.innerHTML = this.testMode ? this.playtestTemplate() : this.editorTemplate();
  }

  private editorTemplate(): string {
    return `<main class="editor-shell">
      <header class="editor-topbar">
        <div class="editor-brand"><a href="/" aria-label="Voltar ao jogo">LIMIAR</a><span>Editor visual de salas</span></div>
        <div class="editor-status"><i></i><span>Salvamento local automático</span><small>${this.project.data.updatedAt ? new Date(this.project.data.updatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'novo mapa'}</small></div>
        <nav><button data-action="new-level">Novo nível</button><button data-action="new-room">Nova sala</button><button data-action="save">Salvar</button><button data-action="export">Exportar JSON</button><button data-action="import">Importar</button><button class="primary" data-action="test">Testar</button></nav>
        <input class="visually-hidden" type="file" accept="application/json,.json" data-role="import-file" />
      </header>
      <div class="editor-layout">
        ${this.leftPanelTemplate()}
        ${this.canvasTemplate()}
        ${this.propertiesTemplate()}
      </div>
      ${this.hotspotEditorOpen ? this.hotspotEditorTemplate() : ''}
    </main>`;
  }

  private leftPanelTemplate(): string {
    const active = this.project.activeLevel;
    return `<aside class="editor-sidebar editor-left">
      <section><div class="panel-title"><span>Níveis</span><b>${this.project.data.levels.length}</b></div>
        <div class="level-list">${this.project.data.levels.map((level) => `<button class="${level.id === active.id ? 'active' : ''}" data-action="select-level" data-level="${esc(level.id)}"><i></i><span>${esc(level.name)}</span><small>${level.rooms.length} salas</small></button>`).join('')}</div>
      </section>
      <section class="room-browser"><div class="panel-title"><span>Perspectivas</span><b>${active.rooms.length}</b></div>
        <div class="room-list">${active.rooms.map((room) => `<button class="${room.id === this.selectedRoomId ? 'active' : ''}" data-action="select-room" data-room="${esc(room.id)}"><img src="${esc(room.image)}" alt="" /><span><b>${esc(room.name)}</b><small>${esc(room.id)}</small></span>${active.startRoomId === room.id ? '<em>INÍCIO</em>' : ''}</button>`).join('')}</div>
      </section>
      <section><div class="panel-title"><span>Imagens do projeto</span><b>${IMAGE_LIBRARY.length}</b></div>
        <div class="asset-grid">${IMAGE_LIBRARY.map((image) => `<button data-action="choose-image" data-image="${esc(image)}" title="${esc(image)}"><img src="${esc(image)}" alt="" /><small>${esc(image.split('/').pop())}</small></button>`).join('')}</div>
        <p class="panel-hint">Adicione arquivos em <code>public/assets/scenes</code> e informe o caminho relativo nas propriedades.</p>
      </section>
    </aside>`;
  }

  private canvasTemplate(): string {
    const level = this.project.activeLevel;
    const lines = level.connections.map((connection) => this.connectionPath(connection)).join('');
    const preview = this.connectionSource ? this.previewConnectionPath() : '';
    return `<section class="editor-workspace">
      <div class="canvas-toolbar"><div><strong>${esc(level.name)}</strong><span>${level.rooms.length} perspectivas · ${level.connections.length} conexões</span></div><nav><button data-action="zoom-out" title="Reduzir zoom">−</button><output data-role="zoom">${Math.round(this.zoom * 100)}%</output><button data-action="zoom-in" title="Aumentar zoom">+</button><button data-action="reset-view">Centralizar</button></nav></div>
      <div class="editor-canvas" data-role="canvas">
        <div class="canvas-grid"></div>
        <div class="canvas-world" data-role="canvas-world" style="transform:translate(${this.pan.x}px,${this.pan.y}px) scale(${this.zoom})">
          <svg class="connection-layer" viewBox="0 0 2400 1600" aria-label="Conexões entre salas"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker></defs>${lines}${preview}</svg>
          ${level.rooms.map((room) => this.roomNodeTemplate(room)).join('')}
        </div>
        <div class="canvas-help"><span>Arraste os blocos para organizar</span><span>Arraste ◉ até outra sala para conectar</span><span>Arraste o fundo para mover o mapa</span></div>
      </div>
    </section>`;
  }

  private roomNodeTemplate(room: EditorRoom): string {
    const selected = room.id === this.selectedRoomId;
    const start = this.project.activeLevel.startRoomId === room.id;
    return `<article class="room-node ${selected ? 'selected' : ''}" data-room="${esc(room.id)}" style="left:${room.position.x}px;top:${room.position.y}px">
      <button class="room-port input" data-role="input-port" title="Destino"></button>
      <button class="room-port output" data-role="output-port" title="Criar conexão">◉</button>
      <button class="room-node-main" data-action="select-room" data-room="${esc(room.id)}">
        <img src="${esc(room.image)}" alt="Miniatura de ${esc(room.name)}" />
        <span><small>${esc(room.code)}</small><strong>${esc(room.name)}</strong><em>${room.hotspots.length} hotspots ${start ? '· início' : ''}</em></span>
      </button>
    </article>`;
  }

  private connectionPath(connection: EditorConnection): string {
    const from = this.project.findRoom(connection.from);
    const to = this.project.findRoom(connection.to);
    if (!from || !to) return '';
    const startX = from.position.x + 232;
    const startY = from.position.y + 68;
    const endX = to.position.x - 12;
    const endY = to.position.y + 68;
    const bend = Math.max(70, Math.abs(endX - startX) * 0.45);
    const path = `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
    return `<g class="connection-line"><path d="${path}" marker-end="url(#arrow)" ${connection.bidirectional ? 'marker-start="url(#arrow)"' : ''}></path><text x="${(startX + endX) / 2}" y="${(startY + endY) / 2 - 9}">${esc(connection.label)}</text></g>`;
  }

  private previewConnectionPath(): string {
    const from = this.connectionSource ? this.project.findRoom(this.connectionSource) : null;
    if (!from) return '';
    const startX = from.position.x + 232;
    const startY = from.position.y + 68;
    return `<path class="connection-preview" d="M ${startX} ${startY} L ${this.connectionPointer.x} ${this.connectionPointer.y}"></path>`;
  }

  private propertiesTemplate(): string {
    const room = this.selectedRoom;
    if (!room) return '<aside class="editor-sidebar editor-properties"><p>Selecione uma sala.</p></aside>';
    const level = this.project.activeLevel;
    const connections = level.connections.filter((connection) => connection.from === room.id || connection.to === room.id);
    return `<aside class="editor-sidebar editor-properties">
      <div class="properties-heading"><div><small>PROPRIEDADES</small><h2>${esc(room.name)}</h2></div><span>${esc(room.id)}</span></div>
      <div class="property-actions"><button data-action="duplicate-room">Duplicar</button><button data-action="set-start" ${level.startRoomId === room.id ? 'disabled' : ''}>Definir início</button><button data-action="set-exit" ${level.escapeRoomId === room.id ? 'disabled' : ''}>Definir saída</button><button class="danger" data-action="delete-room">Excluir</button></div>
      <label><span>Nome</span><input data-room-field="name" value="${esc(room.name)}" /></label>
      <label><span>Código exibido</span><input data-room-field="code" value="${esc(room.code)}" /></label>
      <label><span>Descrição</span><textarea data-room-field="description" rows="3">${esc(room.description)}</textarea></label>
      <label><span>Imagem relativa</span><input data-room-field="image" list="scene-assets" value="${esc(room.image)}" /></label>
      <datalist id="scene-assets">${IMAGE_LIBRARY.map((image) => `<option value="${esc(image)}"></option>`).join('')}</datalist>
      <div class="image-preview"><img src="${esc(room.image)}" alt="Prévia de ${esc(room.name)}" /><span>${esc(room.image)}</span></div>
      <section class="property-section"><div class="panel-title"><span>Conexões</span><b>${connections.length}</b></div>
        ${connections.length ? connections.map((connection) => this.connectionEditorTemplate(connection, room.id)).join('') : '<p class="empty-note">Arraste o ponto ◉ deste bloco até outra sala para criar um caminho.</p>'}
      </section>
      <section class="property-section"><div class="panel-title"><span>Interações</span><b>${room.hotspots.length}</b></div>
        <button class="wide-button primary" data-action="open-hotspots">Editar hotspots na imagem</button>
        <div class="hotspot-summary">${room.hotspots.map((hotspot) => `<button data-action="open-hotspot" data-hotspot="${esc(hotspot.id)}"><i style="background:${esc(hotspot.highlightColor)}"></i><span>${esc(hotspot.label)}</span><small>${esc(hotspot.action)}</small></button>`).join('') || '<p class="empty-note">Nenhuma área interativa criada.</p>'}</div>
      </section>
    </aside>`;
  }

  private connectionEditorTemplate(connection: EditorConnection, roomId: string): string {
    const outgoing = connection.from === roomId;
    const other = this.project.findRoom(outgoing ? connection.to : connection.from);
    return `<div class="connection-editor" data-connection="${esc(connection.id)}"><header><span>${outgoing ? 'SAÍDA' : 'ENTRADA'} · ${esc(other?.name ?? 'sala')}</span><button data-action="delete-connection" data-connection="${esc(connection.id)}" aria-label="Excluir conexão">×</button></header>
      <label><span>Nome no jogo</span><input data-connection-field="label" data-connection="${esc(connection.id)}" value="${esc(connection.label)}" /></label>
      ${outgoing ? `<label><span>Ação / direção</span><input data-connection-field="direction" data-connection="${esc(connection.id)}" value="${esc(connection.direction)}" placeholder="Frente, Esquerda..." /></label>` : ''}
      ${outgoing ? `<label><span>Sala de destino</span><select data-connection-field="to" data-connection="${esc(connection.id)}">${this.roomOptions(connection.to, connection.from)}</select></label>` : ''}
      <label class="check"><input type="checkbox" data-connection-field="bidirectional" data-connection="${esc(connection.id)}" ${connection.bidirectional ? 'checked' : ''} /><span>Bidirecional</span></label>
      ${outgoing ? `<label><span>Exigir item</span><select data-connection-field="requiresItem" data-connection="${esc(connection.id)}"><option value="">Nenhum</option>${this.itemOptions(connection.requiresItem)}</select></label><label><span>Mensagem bloqueada</span><input data-connection-field="lockedMessage" data-connection="${esc(connection.id)}" value="${esc(connection.lockedMessage ?? '')}" /></label>` : ''}
    </div>`;
  }

  private hotspotEditorTemplate(): string {
    const room = this.selectedRoom;
    if (!room) return '';
    const hotspot = room.hotspots.find((entry) => entry.id === this.selectedHotspotId) ?? null;
    const connections = this.project.activeLevel.connections.filter((connection) => connection.from === room.id);
    const connection = connections.find((entry) => entry.id === this.selectedConnectionId) ?? null;
    return `<div class="hotspot-editor-layer"><section class="hotspot-editor-window">
      <header><div><small>EDITOR DA PERSPECTIVA · SEM MECÂNICAS DE JOGO</small><h2>${esc(room.name)}</h2></div><nav><button data-action="add-hotspot">+ Nova área</button><button data-action="close-hotspots">Concluir</button></nav></header>
      <div class="hotspot-editor-layout">
        <div class="hotspot-stage" data-role="hotspot-stage"><img src="${esc(room.image)}" alt="${esc(room.description)}" />${room.hotspots.map((entry) => `<button class="editable-hotspot ${entry.id === this.selectedHotspotId && !connection ? 'selected' : ''}" data-hotspot="${esc(entry.id)}" style="left:${entry.x}%;top:${entry.y}%;width:${entry.width}%;height:${entry.height}%;--hotspot-color:${esc(entry.highlightColor)};--hotspot-strength:${entry.highlightOpacity * 100}%"><span>${esc(entry.label)}</span><i data-role="hotspot-resize"></i></button>`).join('')}${connections.map((entry, index) => this.sceneConnectionMarker(entry, index, connections.length)).join('')}</div>
        <aside class="hotspot-settings">${connection ? this.sceneConnectionFields(connection) : hotspot ? this.hotspotFieldsTemplate(hotspot, room) : '<div class="empty-hotspot"><b>Selecione um elemento</b><p>Clique em um caminho nas bordas ou em uma área interativa sobre a imagem.</p></div>'}</aside>
      </div>
    </section></div>`;
  }

  private sceneConnectionMarker(connection: EditorConnection, index: number, total: number): string {
    const positions: Record<string, string> = { forward: 'left:50%;top:5%', back: 'left:50%;bottom:5%', left: 'left:5%;top:50%', right: 'right:5%;top:50%' };
    const position = positions[connection.direction] ?? `left:${15 + (index + 1) * (70 / (total + 1))}%;bottom:5%`;
    return `<button class="scene-connection ${connection.id === this.selectedConnectionId ? 'selected' : ''}" data-action="select-scene-connection" data-connection="${esc(connection.id)}" style="${position}" title="Editar caminho: ${esc(connection.label)}"><i>${this.directionIcon(connection.direction)}</i><span>${esc(connection.label)}</span></button>`;
  }

  private sceneConnectionFields(connection: EditorConnection): string {
    const destination = this.project.findRoom(connection.to);
    return `<div class="properties-heading"><div><small>CAMINHO</small><h3>${esc(connection.label)}</h3></div><button class="danger" data-action="delete-connection" data-connection="${esc(connection.id)}">Excluir</button></div>
      <label><span>Etiqueta no jogo</span><input data-connection-field="label" data-connection="${esc(connection.id)}" value="${esc(connection.label)}" /></label>
      <label><span>Direção / ação</span><select data-connection-field="direction" data-connection="${esc(connection.id)}"><option value="forward" ${connection.direction === 'forward' ? 'selected' : ''}>Frente</option><option value="back" ${connection.direction === 'back' ? 'selected' : ''}>Trás</option><option value="left" ${connection.direction === 'left' ? 'selected' : ''}>Esquerda</option><option value="right" ${connection.direction === 'right' ? 'selected' : ''}>Direita</option><option value="custom" ${!['forward', 'back', 'left', 'right'].includes(connection.direction) ? 'selected' : ''}>Personalizada</option></select></label>
      <label><span>Destino</span><select data-connection-field="to" data-connection="${esc(connection.id)}">${this.roomOptions(connection.to, connection.from)}</select></label>
      <div class="scene-destination"><img src="${esc(destination?.image ?? '')}" alt="" /><span>${esc(destination?.name ?? connection.to)}</span></div>
      <label class="check"><input type="checkbox" data-connection-field="bidirectional" data-connection="${esc(connection.id)}" ${connection.bidirectional ? 'checked' : ''} /><span>Criar retorno automático</span></label>
      <label><span>Exigir item</span><select data-connection-field="requiresItem" data-connection="${esc(connection.id)}"><option value="">Nenhum</option>${this.itemOptions(connection.requiresItem)}</select></label>
      <label><span>Mensagem quando bloqueado</span><textarea data-connection-field="lockedMessage" data-connection="${esc(connection.id)}" rows="3">${esc(connection.lockedMessage ?? '')}</textarea></label>`;
  }

  private hotspotFieldsTemplate(hotspot: EditorHotspot, room: EditorRoom): string {
    const level = this.project.activeLevel;
    return `<div class="properties-heading"><div><small>HOTSPOT</small><h3>${esc(hotspot.label)}</h3></div><button class="danger" data-action="delete-hotspot">Excluir</button></div>
      <label><span>Etiqueta</span><input data-hotspot-field="label" value="${esc(hotspot.label)}" /></label>
      <label><span>Ação</span><select data-hotspot-field="action"><option value="examine" ${hotspot.action === 'examine' ? 'selected' : ''}>Examinar</option><option value="collect" ${hotspot.action === 'collect' ? 'selected' : ''}>Coletar item</option><option value="use" ${hotspot.action === 'use' ? 'selected' : ''}>Abrir / utilizar</option><option value="move" ${hotspot.action === 'move' ? 'selected' : ''}>Mudar de sala</option><option value="event" ${hotspot.action === 'event' ? 'selected' : ''}>Evento / entidade</option></select></label>
      <label><span>Mensagem ao jogador</span><textarea data-hotspot-field="message" rows="4">${esc(hotspot.message)}</textarea></label>
      ${hotspot.action === 'collect' ? `<label><span>Item coletado</span><select data-hotspot-field="item">${this.itemOptions(hotspot.item)}</select></label>` : ''}
      ${hotspot.action === 'use' ? `<label><span>Item necessário</span><select data-hotspot-field="requiresItem"><option value="">Nenhum</option>${this.itemOptions(hotspot.requiresItem)}</select></label>` : ''}
      ${hotspot.action === 'move' ? `<label><span>Sala de destino</span><select data-hotspot-field="targetRoomId">${level.rooms.filter((entry) => entry.id !== room.id).map((entry) => `<option value="${esc(entry.id)}" ${hotspot.targetRoomId === entry.id ? 'selected' : ''}>${esc(entry.name)}</option>`).join('')}</select></label>` : ''}
      ${hotspot.action === 'event' ? `<label><span>Evento</span><select data-hotspot-field="event"><option value="watcher" ${hotspot.event === 'watcher' ? 'selected' : ''}>O Observador</option><option value="crawler" ${hotspot.event === 'crawler' ? 'selected' : ''}>O Rastejante</option><option value="jumpscare" ${hotspot.event === 'jumpscare' ? 'selected' : ''}>Jumpscare direto</option></select></label>` : ''}
      <div class="field-row"><label><span>Cor do highlight</span><input type="color" data-hotspot-field="highlightColor" value="${esc(hotspot.highlightColor)}" /></label><label><span>Opacidade</span><input type="range" min="0.05" max="0.65" step="0.05" data-hotspot-field="highlightOpacity" value="${hotspot.highlightOpacity}" /></label></div>
      <label class="check"><input type="checkbox" data-hotspot-field="once" ${hotspot.once ? 'checked' : ''} /><span>Executar apenas uma vez</span></label>
      <div class="coordinate-readout"><span>X <b>${hotspot.x.toFixed(1)}%</b></span><span>Y <b>${hotspot.y.toFixed(1)}%</b></span><span>L <b>${hotspot.width.toFixed(1)}%</b></span><span>A <b>${hotspot.height.toFixed(1)}%</b></span></div>
      <p class="panel-hint">Arraste a área para mover. Use o quadrado no canto inferior direito para redimensionar.</p>`;
  }

  private itemOptions(selected?: ItemId): string { return ITEM_OPTIONS.map((item) => `<option value="${item.id}" ${selected === item.id ? 'selected' : ''}>${esc(item.label)}</option>`).join(''); }

  private roomOptions(selected: string, exclude?: string): string {
    return this.project.activeLevel.rooms.filter((room) => room.id !== exclude).map((room) => `<option value="${esc(room.id)}" ${room.id === selected ? 'selected' : ''}>${esc(room.name)}</option>`).join('');
  }

  private playtestTemplate(): string {
    const game = this.testGame;
    if (!game) return '';
    const room = game.room;
    const exits = Object.entries(room.exits);
    const jump = performance.now() < this.testJumpscareUntil;
    return `<main class="editor-playtest">
      <section class="test-scene"><img src="${esc(room.image)}" alt="${esc(room.description)}" /><div class="test-grade"></div>
        ${room.hotspots.filter((hotspot) => !(hotspot.once && game.flags[`hotspot:${room.id}:${hotspot.id}`])).map((hotspot) => `<button class="test-hotspot" data-test-action="hotspot" data-hotspot="${esc(hotspot.id)}" style="left:${hotspot.x + hotspot.width / 2}%;top:${hotspot.y + hotspot.height / 2}%;--highlight:${esc(hotspot.highlight?.color ?? '#d7df77')};--highlight-strength:${(hotspot.highlight?.opacity ?? .22) * 100}%"><span>${esc(hotspot.label)}</span></button>`).join('')}
      </section>
      <header class="test-header"><div><small>${esc(room.code)}</small><strong>${esc(room.name)}</strong></div><nav><button data-test-action="inventory">Inventário (${game.inventory.reduce((sum, item) => sum + item.quantity, 0)})</button><button data-test-action="exit">Voltar ao editor</button></nav></header>
      <div class="test-stats">${this.testStat('health', 'Vida', game.stats.health)}${this.testStat('thirst', 'Sede', game.stats.thirst)}${this.testStat('hunger', 'Fome', game.stats.hunger)}</div>
      <nav class="test-exits">${exits.map(([direction, exit]) => `<button data-test-action="move" data-direction="${esc(direction)}"><i>↗</i><span>${esc(exit.label)}</span>${exit.requiresItem ? `<small>requer ${esc(ITEMS[exit.requiresItem].name)}</small>` : ''}</button>`).join('') || '<span class="dead-end">Sem saídas configuradas</span>'}</nav>
      <div class="test-message">${esc(game.message)}</div>
      ${this.testInventoryOpen ? this.testInventoryTemplate() : ''}
      ${game.encounter ? this.testEncounterTemplate() : ''}
      ${game.status === 'gameover' ? '<div class="test-modal"><section><small>FIM DO TESTE</small><h2>O jogador não sobreviveu</h2><button data-test-action="restart">Reiniciar nesta sala</button><button data-test-action="exit">Voltar ao editor</button></section></div>' : ''}
      ${jump ? `<div class="test-jumpscare"><img src="/assets/entities/${game.encounter?.id ?? 'watcher'}.jpg" alt="Entidade atacando" /></div>` : ''}
      <div class="test-badge">MODO DE TESTE · alterações não afetam o mapa</div>
    </main>`;
  }

  private testStat(key: string, label: string, value: number): string { return `<div data-test-stat="${key}"><span>${label}</span><b>${Math.round(value)}</b><i><em style="width:${value}%"></em></i></div>`; }

  private testInventoryTemplate(): string {
    const game = this.testGame!;
    return `<div class="test-inventory"><section><header><div><small>INVENTÁRIO DO TESTE</small><h2>Itens coletados</h2></div><button data-test-action="inventory">×</button></header><div class="test-item-grid">${game.inventory.map((entry) => `<button class="${game.selectedItem === entry.id ? 'selected' : ''}" data-test-action="use-item" data-item="${entry.id}"><i>${ITEMS[entry.id].icon}</i><span>${esc(ITEMS[entry.id].name)}</span><b>${entry.quantity}</b></button>`).join('') || '<p>Nenhum item coletado.</p>'}</div><p>Consumíveis são usados imediatamente. Ferramentas ficam selecionadas para uso em hotspots.</p></section></div>`;
  }

  private testEncounterTemplate(): string {
    const encounter = this.testGame!.encounter!;
    return `<div class="test-encounter"><img src="/assets/entities/${encounter.id}.jpg" alt="${esc(encounter.name)}" /><section><small>DECISÃO RÁPIDA</small><h2>${esc(encounter.name)}</h2><p>${esc(encounter.prompt)}</p><em>${esc(encounter.hint)}</em><div class="test-timer"><i style="width:${(encounter.remaining / (encounter.id === 'watcher' ? 5 : 4.2)) * 100}%"></i></div><nav><button data-test-action="encounter" data-choice="run">Correr</button><button data-test-action="encounter" data-choice="hide">Esconder-se</button></nav></section></div>`;
  }

  private bindEvents(): void {
    this.root.addEventListener('click', (event) => void this.handleClick(event));
    this.root.addEventListener('dblclick', (event) => this.handleDoubleClick(event));
    this.root.addEventListener('change', (event) => void this.handleChange(event));
    this.root.addEventListener('pointerdown', (event) => this.handlePointerDown(event));
    this.root.addEventListener('wheel', (event) => this.handleWheel(event), { passive: false });
    window.addEventListener('pointermove', (event) => this.handlePointerMove(event));
    window.addEventListener('pointerup', (event) => this.handlePointerUp(event));
  }

  private async handleClick(event: MouseEvent): Promise<void> {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action], [data-test-action]');
    if (!target || target.matches(':disabled')) return;
    if (target.dataset.testAction) { await this.handleTestAction(target.dataset.testAction, target.dataset); return; }
    const action = target.dataset.action;
    if (!action) return;
    switch (action) {
      case 'select-level': this.selectLevel(target.dataset.level ?? ''); break;
      case 'select-room': this.selectedRoomId = target.dataset.room ?? this.selectedRoomId; this.selectedHotspotId = null; this.selectedConnectionId = null; if (event.detail >= 2) this.openPerspective(); break;
      case 'new-room': { const room = this.project.addRoom(); this.selectedRoomId = room.id; break; }
      case 'new-level': { const name = window.prompt('Nome do novo nível:', `Nível ${this.project.data.levels.length}`); if (name) { const level = this.project.addLevel(name); this.selectedRoomId = level.startRoomId; this.resetView(); } break; }
      case 'duplicate-room': { const room = this.project.duplicateRoom(this.selectedRoomId); if (room) this.selectedRoomId = room.id; break; }
      case 'delete-room': if (window.confirm('Excluir esta sala e suas conexões?') && this.project.deleteRoom(this.selectedRoomId)) this.selectedRoomId = this.project.activeLevel.startRoomId; break;
      case 'set-start': this.project.activeLevel.startRoomId = this.selectedRoomId; this.project.save(); break;
      case 'set-exit': this.project.activeLevel.escapeRoomId = this.selectedRoomId; this.project.save(); break;
      case 'delete-connection': this.project.deleteConnection(target.dataset.connection ?? ''); this.selectedConnectionId = null; break;
      case 'save': this.project.save(); break;
      case 'choose-image': if (this.selectedRoom) { this.selectedRoom.image = target.dataset.image ?? this.selectedRoom.image; this.project.save(); } break;
      case 'open-hotspots': this.openPerspective(); break;
      case 'open-hotspot': this.hotspotEditorOpen = true; this.selectedHotspotId = target.dataset.hotspot ?? null; this.selectedConnectionId = null; break;
      case 'select-scene-connection': this.selectedConnectionId = target.dataset.connection ?? null; this.selectedHotspotId = null; break;
      case 'close-hotspots': this.hotspotEditorOpen = false; this.selectedHotspotId = null; this.selectedConnectionId = null; this.project.save(); break;
      case 'add-hotspot': if (this.selectedRoom) { const hotspot = this.project.addHotspot(this.selectedRoom.id); this.selectedHotspotId = hotspot?.id ?? null; this.selectedConnectionId = null; } break;
      case 'delete-hotspot': if (this.selectedRoom && this.selectedHotspotId && window.confirm('Excluir esta área interativa?')) { this.project.deleteHotspot(this.selectedRoom.id, this.selectedHotspotId); this.selectedHotspotId = this.selectedRoom.hotspots[0]?.id ?? null; } break;
      case 'zoom-in': this.setZoom(this.zoom + .12); break;
      case 'zoom-out': this.setZoom(this.zoom - .12); break;
      case 'reset-view': this.resetView(); break;
      case 'test': this.startTest(); return;
      case 'export': this.exportJSON(); return;
      case 'import': this.root.querySelector<HTMLInputElement>('[data-role="import-file"]')?.click(); return;
    }
    this.render();
  }

  private handleDoubleClick(event: MouseEvent): void {
    if (this.testMode) return;
    const node = (event.target as HTMLElement).closest<HTMLElement>('.room-node');
    if (!node?.dataset.room) return;
    this.selectedRoomId = node.dataset.room;
    this.openPerspective();
    this.render();
  }

  private openPerspective(): void {
    this.hotspotEditorOpen = true;
    this.selectedHotspotId = this.selectedRoom?.hotspots[0]?.id ?? null;
    this.selectedConnectionId = null;
  }

  private async handleChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (input.matches('[data-role="import-file"]') && input instanceof HTMLInputElement) { await this.importJSON(input.files?.[0]); return; }
    const roomField = input.dataset.roomField as keyof Pick<EditorRoom, 'name' | 'code' | 'description' | 'image'> | undefined;
    if (roomField && this.selectedRoom) { this.selectedRoom[roomField] = input.value; this.project.save(); this.render(); return; }
    const connectionId = input.dataset.connection;
    const connectionField = input.dataset.connectionField as keyof EditorConnection | undefined;
    if (connectionId && connectionField) {
      const connection = this.project.activeLevel.connections.find((entry) => entry.id === connectionId);
      if (connection) {
        if (connectionField === 'bidirectional') connection.bidirectional = (input as HTMLInputElement).checked;
        else if (connectionField === 'requiresItem') connection.requiresItem = input.value ? input.value as ItemId : undefined;
        else if (connectionField === 'label' || connectionField === 'direction' || connectionField === 'lockedMessage' || connectionField === 'to') connection[connectionField] = input.value;
        this.project.save(); this.render();
      }
      return;
    }
    const hotspotField = input.dataset.hotspotField as keyof EditorHotspot | undefined;
    const hotspot = this.selectedRoom?.hotspots.find((entry) => entry.id === this.selectedHotspotId);
    if (hotspotField && hotspot) {
      if (hotspotField === 'once') hotspot.once = (input as HTMLInputElement).checked;
      else if (hotspotField === 'highlightOpacity') hotspot.highlightOpacity = Number(input.value);
      else if (hotspotField === 'item' || hotspotField === 'requiresItem') hotspot[hotspotField] = input.value ? input.value as ItemId : undefined;
      else if (hotspotField === 'action') hotspot.action = input.value as EditorHotspot['action'];
      else if (hotspotField === 'event') hotspot.event = input.value as EditorHotspot['event'];
      else if (hotspotField === 'label' || hotspotField === 'message' || hotspotField === 'targetRoomId' || hotspotField === 'highlightColor') hotspot[hotspotField] = input.value;
      this.project.save(); this.render();
    }
  }

  private handlePointerDown(event: PointerEvent): void {
    if (this.testMode || event.button !== 0) return;
    const target = event.target as HTMLElement;
    const hotspotBox = target.closest<HTMLElement>('.editable-hotspot');
    const stage = target.closest<HTMLElement>('[data-role="hotspot-stage"]');
    if (hotspotBox && stage && this.selectedRoom) {
      const hotspot = this.selectedRoom.hotspots.find((entry) => entry.id === hotspotBox.dataset.hotspot);
      if (!hotspot) return;
      this.selectedHotspotId = hotspot.id;
      this.selectedConnectionId = null;
      this.gesture = { type: 'hotspot', roomId: this.selectedRoom.id, hotspotId: hotspot.id, resize: Boolean(target.closest('[data-role="hotspot-resize"]')), startX: event.clientX, startY: event.clientY, origin: { x: hotspot.x, y: hotspot.y, width: hotspot.width, height: hotspot.height }, rect: stage.getBoundingClientRect() };
      hotspotBox.classList.add('selected');
      event.preventDefault();
      return;
    }
    const output = target.closest<HTMLElement>('[data-role="output-port"]');
    const node = target.closest<HTMLElement>('.room-node');
    if (output && node) {
      this.connectionSource = node.dataset.room ?? null;
      this.connectionPointer = this.toWorld(event.clientX, event.clientY);
      this.render();
      event.preventDefault();
      return;
    }
    if (node && (target.closest('.room-node-main') || target.closest('.room-node'))) {
      const room = this.project.findRoom(node.dataset.room ?? '');
      if (!room) return;
      this.selectedRoomId = room.id;
      this.gesture = { type: 'room', roomId: room.id, startX: event.clientX, startY: event.clientY, originX: room.position.x, originY: room.position.y };
      event.preventDefault();
      return;
    }
    const canvas = target.closest<HTMLElement>('[data-role="canvas"]');
    if (canvas) {
      this.gesture = { type: 'pan', startX: event.clientX, startY: event.clientY, originX: this.pan.x, originY: this.pan.y };
      canvas.classList.add('panning');
      event.preventDefault();
    }
  }

  private handlePointerMove(event: PointerEvent): void {
    if (this.connectionSource) {
      this.connectionPointer = this.toWorld(event.clientX, event.clientY);
      const from = this.project.findRoom(this.connectionSource);
      const preview = this.root.querySelector<SVGPathElement>('.connection-preview');
      if (from && preview) preview.setAttribute('d', `M ${from.position.x + 232} ${from.position.y + 68} L ${this.connectionPointer.x} ${this.connectionPointer.y}`);
    }
    if (!this.gesture) return;
    if (this.gesture.type === 'room') {
      const room = this.project.findRoom(this.gesture.roomId);
      if (!room) return;
      room.position.x = Math.round(this.gesture.originX + (event.clientX - this.gesture.startX) / this.zoom);
      room.position.y = Math.round(this.gesture.originY + (event.clientY - this.gesture.startY) / this.zoom);
      const node = this.root.querySelector<HTMLElement>(`.room-node[data-room="${CSS.escape(room.id)}"]`);
      if (node) { node.style.left = `${room.position.x}px`; node.style.top = `${room.position.y}px`; }
      this.redrawConnectionLines();
    } else if (this.gesture.type === 'pan') {
      this.pan.x = this.gesture.originX + event.clientX - this.gesture.startX;
      this.pan.y = this.gesture.originY + event.clientY - this.gesture.startY;
      this.applyWorldTransform();
    } else {
      const gesture = this.gesture;
      if (gesture.type !== 'hotspot') return;
      const room = this.project.findRoom(gesture.roomId);
      const hotspot = room?.hotspots.find((entry) => entry.id === gesture.hotspotId);
      if (!room || !hotspot) return;
      const dx = ((event.clientX - gesture.startX) / gesture.rect.width) * 100;
      const dy = ((event.clientY - gesture.startY) / gesture.rect.height) * 100;
      if (gesture.resize) {
        hotspot.width = clamp(gesture.origin.width + dx, 3, 100 - hotspot.x);
        hotspot.height = clamp(gesture.origin.height + dy, 3, 100 - hotspot.y);
      } else {
        hotspot.x = clamp(gesture.origin.x + dx, 0, 100 - hotspot.width);
        hotspot.y = clamp(gesture.origin.y + dy, 0, 100 - hotspot.height);
      }
      const box = this.root.querySelector<HTMLElement>(`.editable-hotspot[data-hotspot="${CSS.escape(hotspot.id)}"]`);
      if (box) { box.style.left = `${hotspot.x}%`; box.style.top = `${hotspot.y}%`; box.style.width = `${hotspot.width}%`; box.style.height = `${hotspot.height}%`; }
    }
  }

  private handlePointerUp(event: PointerEvent): void {
    if (this.connectionSource) {
      const targetNode = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.room-node');
      if (targetNode?.dataset.room) this.project.addConnection(this.connectionSource, targetNode.dataset.room);
      this.connectionSource = null;
      this.gesture = null;
      this.render();
      return;
    }
    if (!this.gesture) return;
    this.project.save();
    const wasHotspot = this.gesture.type === 'hotspot';
    this.gesture = null;
    if (wasHotspot) this.render();
    else this.root.querySelector('[data-role="canvas"]')?.classList.remove('panning');
  }

  private handleWheel(event: WheelEvent): void {
    if (this.testMode || !(event.target as HTMLElement).closest('[data-role="canvas"]')) return;
    event.preventDefault();
    const canvas = this.root.querySelector<HTMLElement>('[data-role="canvas"]');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const world = { x: (point.x - this.pan.x) / this.zoom, y: (point.y - this.pan.y) / this.zoom };
    const next = clamp(this.zoom * (event.deltaY > 0 ? .9 : 1.1), .35, 1.6);
    this.pan = { x: point.x - world.x * next, y: point.y - world.y * next };
    this.zoom = next;
    this.applyWorldTransform();
  }

  private toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.root.querySelector<HTMLElement>('[data-role="canvas"]')?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (clientX - rect.left - this.pan.x) / this.zoom, y: (clientY - rect.top - this.pan.y) / this.zoom };
  }

  private applyWorldTransform(): void {
    const world = this.root.querySelector<HTMLElement>('[data-role="canvas-world"]');
    const label = this.root.querySelector<HTMLOutputElement>('[data-role="zoom"]');
    if (world) world.style.transform = `translate(${this.pan.x}px,${this.pan.y}px) scale(${this.zoom})`;
    if (label) label.value = `${Math.round(this.zoom * 100)}%`;
  }

  private redrawConnectionLines(): void {
    const svg = this.root.querySelector<SVGElement>('.connection-layer');
    if (!svg) return;
    const definitions = svg.querySelector('defs')?.outerHTML ?? '';
    svg.innerHTML = definitions + this.project.activeLevel.connections.map((connection) => this.connectionPath(connection)).join('') + (this.connectionSource ? this.previewConnectionPath() : '');
  }

  private setZoom(value: number): void { this.zoom = clamp(value, .35, 1.6); this.applyWorldTransform(); }
  private resetView(): void { this.pan = { x: 80, y: 60 }; this.zoom = .82; this.applyWorldTransform(); }

  private selectLevel(id: string): void {
    this.project.setActiveLevel(id);
    this.selectedRoomId = this.project.activeLevel.startRoomId;
    this.selectedHotspotId = null;
    this.selectedConnectionId = null;
    this.resetView();
  }

  private directionIcon(direction: string): string {
    return ({ forward: '↑', back: '↓', left: '←', right: '→' } as Record<string, string>)[direction] ?? '↗';
  }

  private exportJSON(): void {
    this.project.save();
    const blob = new Blob([this.project.toJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `${this.project.data.name.toLowerCase().replace(/\s+/g, '-') || 'mapa'}.json`; link.click();
    URL.revokeObjectURL(url);
  }

  private async importJSON(file?: File): Promise<void> {
    if (!file) return;
    try {
      this.project.replace(JSON.parse(await file.text()) as unknown);
      this.selectedRoomId = this.project.activeLevel.startRoomId;
      this.resetView(); this.render();
    } catch { window.alert('Não foi possível carregar este JSON. Verifique o formato do arquivo.'); }
  }

  private startTest(): void {
    const level = this.project.activeLevel;
    const start = this.selectedRoomId || level.startRoomId;
    this.testGame = new Game(undefined, () => 1, levelToWorld(level), start);
    this.testMode = true;
    this.testInventoryOpen = false;
    this.testAttackNonce = 0;
    this.testJumpscareUntil = 0;
    this.lastTestKey = '';
    this.render();
  }

  private async handleTestAction(action: string, data: DOMStringMap): Promise<void> {
    const game = this.testGame;
    if (!game) return;
    void this.audio.unlock().catch(() => undefined);
    switch (action) {
      case 'exit': this.testMode = false; this.testGame = null; this.testInventoryOpen = false; this.render(); return;
      case 'move': { const result = game.navigate(data.direction ?? ''); this.audio.play(result.changed ? 'step' : 'locked'); break; }
      case 'hotspot': { const result = game.interact(data.hotspot ?? ''); this.audio.play(result.pickup ? 'pickup' : result.changed ? 'use' : 'click'); break; }
      case 'inventory': this.testInventoryOpen = !this.testInventoryOpen; this.audio.play('click'); break;
      case 'use-item': game.useItem(data.item as ItemId); this.audio.play('use'); this.testInventoryOpen = false; break;
      case 'encounter': { const result = game.respondToEncounter(data.choice as EncounterAction); this.audio.play(result.attack ? 'jumpscare' : 'step'); break; }
      case 'restart': this.startTest(); return;
    }
    if (game.attackNonce !== this.testAttackNonce) { this.testAttackNonce = game.attackNonce; this.testJumpscareUntil = performance.now() + 850; }
    this.lastTestKey = '';
    this.render();
  }

  private readonly tick = (now: number): void => {
    const delta = Math.min(.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.testMode && this.testGame) {
      this.testGame.update(delta);
      if (this.testGame.attackNonce !== this.testAttackNonce) {
        this.testAttackNonce = this.testGame.attackNonce;
        this.testJumpscareUntil = now + 850;
        this.audio.play('jumpscare');
      }
      const key = JSON.stringify({ position: this.testGame.position, status: this.testGame.status, message: this.testGame.message, inventory: this.testGame.inventory, selected: this.testGame.selectedItem, encounter: this.testGame.encounter?.id, attack: this.testAttackNonce, jump: now < this.testJumpscareUntil, panel: this.testInventoryOpen });
      if (key !== this.lastTestKey) { this.lastTestKey = key; this.render(); }
      else this.updateTestReadouts();
    }
    requestAnimationFrame(this.tick);
  };

  private updateTestReadouts(): void {
    if (!this.testGame) return;
    (['health', 'thirst', 'hunger'] as const).forEach((key) => {
      const root = this.root.querySelector<HTMLElement>(`[data-test-stat="${key}"]`);
      const value = this.testGame!.stats[key];
      if (root?.querySelector('b')) root.querySelector('b')!.textContent = String(Math.round(value));
      const bar = root?.querySelector<HTMLElement>('em'); if (bar) bar.style.width = `${value}%`;
    });
    const timer = this.root.querySelector<HTMLElement>('.test-timer i');
    if (timer && this.testGame.encounter) timer.style.width = `${(this.testGame.encounter.remaining / (this.testGame.encounter.id === 'watcher' ? 5 : 4.2)) * 100}%`;
  }
}
