import { Game } from '../core/Game';
import type { RoomDefinition } from '../config/world';
import { AudioSystem } from '../systems/AudioSystem';
import { isLevelZero, MUSIC_LOBBY } from '../systems/audioLibrary';
import { drawRoomLighting, hasFlicker, isLightShape, LIGHT_SHAPES } from '../systems/lighting';
import { DEFAULT_PATH_POSITIONS, defaultArrowRotation } from '../config/paths';
import { DEFAULT_PREFERENCES } from '../systems/SaveSystem';
import { labelAnchorOf } from '../systems/hotspots';
import type { EncounterAction, ItemId } from '../types';
import { EditorProject } from './EditorProject';
import { entitiesToRuntime, itemsToRuntime, projectToWorld } from './mapAdapter';
import { createLight, DEFAULT_SHAPE_POINT_COUNT, ENTITY_IMAGE_LIBRARY, IMAGE_LIBRARY, ROOM_AUDIO_MODES, detectMediaType, type EditorConnection, type EditorEntity, type EditorHotspot, type EditorItem, type EditorLight, type EditorRoom } from './types';
import type { RoomAudioMode } from '../config/world';

/** O que a área de transferência do editor está guardando. */
type ClipboardEntry =
  | { kind: 'hotspot'; data: EditorHotspot }
  | { kind: 'light'; data: EditorLight }
  | { kind: 'room'; data: EditorRoom }
  | { kind: 'item'; data: EditorItem }
  | { kind: 'entity'; data: EditorEntity };

const CLIPBOARD_LABELS: Record<ClipboardEntry['kind'], string> = {
  hotspot: 'interagível', light: 'foco de luz', room: 'sala', item: 'item', entity: 'entidade',
};

type Panel = 'map' | 'items' | 'entities';

/**
 * Uma pergunta de sim/não desenhada pelo próprio editor. `window.confirm` não aparece
 * em todos os navegadores — quando ele é bloqueado a pergunta volta `false` na hora e
 * a exclusão simplesmente não acontecia, sem nenhum aviso.
 */
interface EditorConfirm {
  title: string;
  message: string;
  confirmLabel: string;
  run: () => void;
}

type Gesture =
  | { type: 'room'; roomId: string; startX: number; startY: number; originX: number; originY: number }
  | { type: 'pan'; startX: number; startY: number; originX: number; originY: number }
  | { type: 'hotspot'; roomId: string; hotspotId: string; resize: boolean; startX: number; startY: number; origin: { x: number; y: number; width: number; height: number }; rect: DOMRect }
  | { type: 'shapePoint'; roomId: string; hotspotId: string; pointIndex: number; startX: number; startY: number; origin: { x: number; y: number }; rect: DOMRect }
  | { type: 'indicator'; roomId: string; hotspotId: string; startX: number; startY: number; origin: { x: number; y: number }; rect: DOMRect }
  | { type: 'connectionButton'; connectionId: string; startX: number; startY: number; origin: { x: number; y: number }; rect: DOMRect }
  | { type: 'lightSpot'; roomId: string; lightId: string; startX: number; startY: number; origin: { x: number; y: number }; rect: DOMRect };

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const circlePoints = (count = DEFAULT_SHAPE_POINT_COUNT): Array<{ x: number; y: number }> => Array.from({ length: count }, (_, index) => {
  const angle = (index / count) * Math.PI * 2;
  return { x: Math.round((50 + 50 * Math.cos(angle)) * 10) / 10, y: Math.round((50 + 50 * Math.sin(angle)) * 10) / 10 };
});

/** Proporção do palco, a mesma moldura que o jogo usa para enquadrar a cena. */
const STAGE_ASPECT = 16 / 9;

export class EditorApp {
  private readonly project = new EditorProject();
  private readonly audio = new AudioSystem(DEFAULT_PREFERENCES);
  private activePanel: Panel = 'map';
  private selectedRoomId = this.project.activeLevel.startRoomId;
  private selectedHotspotId: string | null = null;
  private selectedConnectionId: string | null = null;
  private selectedItemId: string | null = this.project.data.items[0]?.id ?? null;
  private selectedEntityId: string | null = this.project.data.entities[0]?.id ?? null;
  private hotspotEditorOpen = false;
  private selectedLightId: string | null = null;
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
  private browseTarget = '';
  /** Ctrl+C / Ctrl+V do editor: um só item por vez, sempre uma cópia independente. */
  private clipboard: ClipboardEntry | null = null;
  private clipboardNote = '';
  /** Arquivos de áudio encontrados em `public/assets/audio`, para a trilha das salas. */
  private audioFiles: string[] = [];
  /** Confirmação aberta; a ação só roda quando o editor diz que sim. */
  private confirm: EditorConfirm | null = null;

  constructor(private readonly root: HTMLElement) {
    this.bindEvents();
    void this.loadAudioFiles();
  }

  /** Lê o manifesto de áudio para oferecer os arquivos existentes na trilha da sala. */
  private async loadAudioFiles(): Promise<void> {
    try {
      const response = await fetch('/assets/audio/manifest.json', { cache: 'no-cache' });
      if (!response.ok) return;
      const payload = (await response.json()) as { files?: unknown };
      if (!Array.isArray(payload.files)) return;
      this.audioFiles = payload.files.filter((file): file is string => typeof file === 'string').sort();
      if (!this.testMode) this.render();
    } catch { /* sem manifesto a trilha da sala continua aceitando um caminho digitado */ }
  }

  start(): void {
    this.render();
    requestAnimationFrame(this.tick);
  }

  private get selectedRoom(): EditorRoom | undefined { return this.project.findRoom(this.selectedRoomId); }
  private get selectedItem(): EditorItem | undefined { return this.project.findItem(this.selectedItemId ?? ''); }
  private get selectedEntity(): EditorEntity | undefined { return this.project.findEntity(this.selectedEntityId ?? ''); }

  private render(): void {
    this.root.innerHTML = this.testMode ? this.playtestTemplate() : this.editorTemplate();
    if (this.testMode) this.bindTestCutsceneVideo();
    else if (this.hotspotEditorOpen) this.updateDarknessCanvas();
  }

  private updateDarknessCanvas(): void {
    const canvas = this.root.querySelector<HTMLCanvasElement>('[data-role="darkness-canvas"]');
    if (!canvas) return;
    const room = this.selectedRoom;
    const width = canvas.offsetWidth || 640;
    const height = canvas.offsetHeight || 360;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawRoomLighting(ctx, canvas.width, canvas.height, room?.darknessLevel ?? 0, room?.lights ?? [], performance.now());
  }

  private editorTemplate(): string {
    return `<main class="editor-shell">
      <header class="editor-topbar">
        <div class="editor-brand"><a href="/" aria-label="Voltar ao jogo">HYDRAPHOBIA</a><span>Editor visual de salas</span></div>
        <div class="editor-status"><i></i><span>Salvamento local automático</span><small>${this.project.data.updatedAt ? new Date(this.project.data.updatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'novo mapa'}</small></div>
        <nav>
          <button data-action="panel-map" class="${this.activePanel === 'map' ? 'primary' : ''}">Mapa</button>
          <button data-action="panel-items" class="${this.activePanel === 'items' ? 'primary' : ''}">Itens</button>
          <button data-action="panel-entities" class="${this.activePanel === 'entities' ? 'primary' : ''}">Entidades</button>
          ${this.activePanel === 'map' ? '<button data-action="new-level">Novo nível</button><button data-action="new-room">Nova sala</button>' : ''}
          <button data-action="save">Salvar</button><button data-action="export">Exportar JSON</button><button data-action="import">Importar</button><button class="primary" data-action="test">Testar</button>
        </nav>
        <input class="visually-hidden" type="file" accept="application/json,.json" data-role="import-file" />
        <input class="visually-hidden" type="file" accept="image/*" data-role="browse-image" />
        <input class="visually-hidden" type="file" accept="image/*,.gif,video/*" data-role="browse-media" />
      </header>
      ${this.activePanel === 'map' ? `<div class="editor-layout">${this.leftPanelTemplate()}${this.canvasTemplate()}${this.propertiesTemplate()}</div>` : ''}
      ${this.activePanel === 'items' ? this.itemsPanelTemplate() : ''}
      ${this.activePanel === 'entities' ? this.entitiesPanelTemplate() : ''}
      ${this.hotspotEditorOpen ? this.hotspotEditorTemplate() : ''}
      ${this.confirmTemplate()}
    </main>`;
  }

  private confirmTemplate(): string {
    const request = this.confirm;
    if (!request) return '';
    return `<div class="editor-confirm-layer" role="dialog" aria-modal="true" aria-label="${esc(request.title)}">
      <section class="editor-confirm">
        <small>CONFIRMAÇÃO</small>
        <h2>${esc(request.title)}</h2>
        <p>${esc(request.message)}</p>
        <div class="editor-confirm-actions">
          <button data-action="confirm-cancel">Cancelar</button>
          <button class="danger" data-action="confirm-accept">${esc(request.confirmLabel)}</button>
        </div>
      </section>
    </div>`;
  }

  /** Abre a pergunta; nada é excluído antes de o editor responder. */
  private askConfirm(request: EditorConfirm): void {
    this.confirm = request;
    this.render();
  }

  private leftPanelTemplate(): string {
    const active = this.project.activeLevel;
    return `<aside class="editor-sidebar editor-left">
      <section><div class="panel-title"><span>Níveis</span><b>${this.project.data.levels.length}</b></div>
        <div class="level-list">${this.project.data.levels.map((level) => `<div class="level-row ${level.id === active.id ? 'active' : ''}">
          <button data-action="select-level" data-level="${esc(level.id)}"><i></i><span>${esc(level.name)}</span><small>${level.rooms.length} ${level.rooms.length === 1 ? 'sala' : 'salas'}</small></button>
          <button class="level-rename" data-action="rename-level" data-level="${esc(level.id)}" title="Renomear nível" aria-label="Renomear ${esc(level.name)}">&#9998;</button>
        </div>`).join('')}</div>
        <div class="level-tools">
          <label><span>Nome do nível aberto</span><input data-level-field="name" data-level="${esc(active.id)}" value="${esc(active.name)}" maxlength="64" /></label>
          <div class="level-tool-row">
            <button data-action="new-level">+ Novo nível</button>
            <button class="danger" data-action="delete-level" data-level="${esc(active.id)}" ${this.project.data.levels.length <= 1 ? 'disabled' : ''}>Excluir nível</button>
          </div>
        </div>
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
        <div class="canvas-help"><span>Arraste os blocos para organizar</span><span>Arraste ◉ até outra sala para conectar</span><span>Ctrl+C / Ctrl+V duplicam o que estiver selecionado</span></div>
        ${this.clipboardNote ? `<div class="clipboard-toast" role="status">${esc(this.clipboardNote)}</div>` : ''}
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
      <label><span>Imagem relativa</span><div class="input-with-browse"><input data-room-field="image" list="scene-assets" value="${esc(room.image)}" /><button type="button" data-action="browse-file" data-target-field="room-image" data-accept="image/*">Procurar</button></div></label>
      <datalist id="scene-assets">${IMAGE_LIBRARY.map((image) => `<option value="${esc(image)}"></option>`).join('')}</datalist>
      <div class="image-preview"><img src="${esc(room.image)}" alt="Prévia de ${esc(room.name)}" /><span>${esc(room.image)}</span></div>
      <section class="property-section"><div class="panel-title"><span>Conexões</span><b>${connections.length}</b></div>
        ${connections.length ? connections.map((connection) => this.connectionEditorTemplate(connection, room.id)).join('') : '<p class="empty-note">Arraste o ponto ◉ deste bloco até outra sala para criar um caminho.</p>'}
      </section>
      <section class="property-section"><div class="panel-title"><span>Interações</span><b>${room.hotspots.length}</b></div>
        <button class="wide-button primary" data-action="open-hotspots">Editar hotspots na imagem</button>
        <div class="hotspot-summary">${room.hotspots.map((hotspot) => `<button data-action="open-hotspot" data-hotspot="${esc(hotspot.id)}"><i style="background:${esc(hotspot.highlightColor)}"></i><span>${esc(hotspot.label)}</span><small>${esc(hotspot.action)}${hotspot.visibility !== 'visible' ? ` · ${hotspot.visibility === 'hidden' ? 'escondido' : 'invisível'}` : ''}</small></button>`).join('') || '<p class="empty-note">Nenhuma área interativa criada.</p>'}</div>
      </section>
    </aside>`;
  }

  private connectionEditorTemplate(connection: EditorConnection, roomId: string): string {
    const outgoing = connection.from === roomId;
    const other = this.project.findRoom(outgoing ? connection.to : connection.from);
    return `<div class="connection-editor" data-connection="${esc(connection.id)}"><header><span>${outgoing ? 'SAÍDA' : 'ENTRADA'} · ${esc(other?.name ?? 'sala')}</span><button data-action="delete-connection" data-connection="${esc(connection.id)}" aria-label="Excluir conexão">×</button></header>
      <label><span>Nome no jogo</span><input data-connection-field="label" data-connection="${esc(connection.id)}" value="${esc(connection.label)}" /></label>
      ${outgoing ? `<label><span>Ação / direção</span><input data-connection-field="direction" data-connection="${esc(connection.id)}" value="${esc(connection.direction)}" placeholder="Frente, Esquerda..." /></label>` : ''}
      ${outgoing ? this.destinationFields(connection.toLevelId ?? this.project.activeLevel.id, connection.to, connection.from, connection.id) : ''}
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
      <header><div><small>EDITOR DA PERSPECTIVA · SEM MECÂNICAS DE JOGO</small><h2>${esc(room.name)}</h2></div><nav><button data-action="scene-lighting" class="${!hotspot && !connection ? 'primary' : ''}">☀ Luz da cena</button><button data-action="add-hotspot">+ Novo interagível</button><button data-action="close-hotspots">Concluir</button></nav></header>
      ${this.clipboardNote ? `<div class="clipboard-toast inside" role="status">${esc(this.clipboardNote)}</div>` : ''}
      <div class="hotspot-editor-layout">
        <div class="hotspot-stage" data-role="hotspot-stage"><img src="${esc(room.image)}" alt="${esc(room.description)}" />${room.hotspots.map((entry) => this.editableHotspotTemplate(entry, connection)).join('')}${connections.map((entry, index) => this.sceneConnectionMarker(entry, index, connections.length)).join('')}${this.lightMarkersTemplate(room)}<canvas class="stage-darkness-canvas" data-role="darkness-canvas" aria-hidden="true"></canvas>${this.cropGuideTemplate()}</div>
        <aside class="hotspot-settings">${connection ? this.sceneConnectionFields(connection) : hotspot ? this.hotspotFieldsTemplate(hotspot) : this.sceneLightingTemplate(room)}</aside>
      </div>
    </section></div>`;
  }

  private editableHotspotTemplate(entry: EditorHotspot, connection: EditorConnection | null): string {
    const selected = entry.id === this.selectedHotspotId && !connection;
    const clip = entry.shapePoints ? `clip-path:polygon(${entry.shapePoints.map((point) => `${point.x}% ${point.y}%`).join(',')});` : '';
    const shapePointHandles = selected && entry.shapePoints ? entry.shapePoints.map((point, index) => `<i class="shape-point" data-role="shape-point" data-point="${index}" style="left:${point.x}%;top:${point.y}%"></i>`).join('') : '';
    const indicatorHandle = selected ? `<i class="indicator-point" data-role="indicator-point" title="Círculo visível ao jogador" style="left:${entry.indicator.x}%;top:${entry.indicator.y}%"></i>` : '';
    const indicatorPreview = `<i class="hotspot-indicator-preview" aria-hidden="true" style="left:${entry.indicator.x}%;top:${entry.indicator.y}%"></i>`;
    // O `clip-path` corta qualquer borda CSS do contorno irregular, então a delimitação
    // pontilhada dos interagíveis circulares é desenhada em SVG sobre a área.
    const outline = entry.shapePoints
      ? `<svg class="hotspot-outline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points="${entry.shapePoints.map((point) => `${point.x},${point.y}`).join(' ')}"></polygon></svg>`
      : '';
    return `<button class="editable-hotspot ${selected ? 'selected' : ''} ${entry.visibility !== 'visible' ? 'muted-visibility' : ''} ${entry.shapePoints ? 'shape-mode' : ''}" data-hotspot="${esc(entry.id)}" style="left:${entry.x}%;top:${entry.y}%;width:${entry.width}%;height:${entry.height}%;--hotspot-color:${esc(entry.highlightColor)};--hotspot-strength:${entry.highlightOpacity * 100}%">
      <i class="hotspot-fill" style="${clip}"></i>
      ${outline}
      ${indicatorPreview}
      <span>${esc(entry.label)}</span>
      ${entry.shapePoints ? '' : '<i data-role="hotspot-resize"></i>'}
      ${shapePointHandles}
      ${indicatorHandle}
    </button>`;
  }

  private sceneConnectionMarker(connection: EditorConnection, index: number, total: number): string {
    const fallback = DEFAULT_PATH_POSITIONS[connection.direction] ?? { x: 15 + (index + 1) * (70 / (total + 1)), y: 95 };
    const x = connection.buttonX ?? fallback.x;
    const y = connection.buttonY ?? fallback.y;
    const rotation = connection.arrowRotation ?? defaultArrowRotation(connection.direction);
    // `path-marker` é a mesma classe do botão no jogo: a aparência é uma só.
    return `<button class="path-marker scene-connection ${connection.id === this.selectedConnectionId ? 'selected' : ''}" data-action="select-scene-connection" data-connection="${esc(connection.id)}" style="left:${x}%;top:${y}%" title="Arraste para posicionar · clique para editar: ${esc(connection.label)}"><i style="--rotate:${rotation}deg">↑</i><span>${esc(connection.label)}</span></button>`;
  }

  private sceneConnectionFields(connection: EditorConnection): string {
    const destination = this.project.findRoom(connection.to);
    const fallback = DEFAULT_PATH_POSITIONS[connection.direction] ?? { x: 50, y: 95 };
    return `<div class="properties-heading"><div><small>CAMINHO</small><h3>${esc(connection.label)}</h3></div><button class="danger" data-action="delete-connection" data-connection="${esc(connection.id)}">Excluir</button></div>
      <label><span>Etiqueta no jogo</span><input data-connection-field="label" data-connection="${esc(connection.id)}" value="${esc(connection.label)}" /></label>
      <label><span>Direção / ação</span><select data-connection-field="direction" data-connection="${esc(connection.id)}"><option value="forward" ${connection.direction === 'forward' ? 'selected' : ''}>Frente</option><option value="back" ${connection.direction === 'back' ? 'selected' : ''}>Trás</option><option value="left" ${connection.direction === 'left' ? 'selected' : ''}>Esquerda</option><option value="right" ${connection.direction === 'right' ? 'selected' : ''}>Direita</option><option value="custom" ${!['forward', 'back', 'left', 'right'].includes(connection.direction) ? 'selected' : ''}>Personalizada</option></select></label>
      ${!['forward', 'back', 'left', 'right'].includes(connection.direction) ? `<label><span>Nome da direção personalizada</span><input data-connection-field="customDirection" data-connection="${esc(connection.id)}" value="${esc(connection.direction)}" placeholder="ex: escada, buraco, túnel" /></label>` : ''}
      ${this.destinationFields(connection.toLevelId ?? this.project.activeLevel.id, connection.to, connection.from, connection.id)}
      <div class="scene-destination"><img src="${esc(destination?.image ?? '')}" alt="" /><span>${esc(destination?.name ?? connection.to)}</span></div>
      <label class="check"><input type="checkbox" data-connection-field="bidirectional" data-connection="${esc(connection.id)}" ${connection.bidirectional ? 'checked' : ''} /><span>Criar retorno automático</span></label>
      <label><span>Exigir item</span><select data-connection-field="requiresItem" data-connection="${esc(connection.id)}"><option value="">Nenhum</option>${this.itemOptions(connection.requiresItem)}</select></label>
      <label><span>Mensagem quando bloqueado</span><textarea data-connection-field="lockedMessage" data-connection="${esc(connection.id)}" rows="3">${esc(connection.lockedMessage ?? '')}</textarea></label>
      <section class="property-section">
        <div class="panel-title"><span>Botão na tela</span></div>
        <p class="panel-hint">Arraste a seta sobre a imagem para reposicionar o botão de movimento.</p>
        <div class="field-row"><label><span>X %</span><input type="number" min="0" max="100" step="0.5" data-connection-field="buttonX" data-connection="${esc(connection.id)}" value="${(connection.buttonX ?? fallback.x).toFixed(1)}" /></label><label><span>Y %</span><input type="number" min="0" max="100" step="0.5" data-connection-field="buttonY" data-connection="${esc(connection.id)}" value="${(connection.buttonY ?? fallback.y).toFixed(1)}" /></label></div>
        <label><span>Rotação da seta (graus)</span><input type="number" min="0" max="359" step="5" data-connection-field="arrowRotation" data-connection="${esc(connection.id)}" value="${connection.arrowRotation ?? defaultArrowRotation(connection.direction)}" /></label>
        <button class="wide-button" data-action="reset-connection-button" data-connection="${esc(connection.id)}">Redefinir posição padrão</button>
      </section>`;
  }

  /**
   * O que a janela do jogador mostra desta cena. O jogo enquadra a sala num 16:9 e
   * amplia até cobrir a tela, então uma janela mais larga ou mais alta corta as
   * bordas. Este contorno marca o que sobra, para nada importante ficar de fora.
   */
  private cropGuideTemplate(): string {
    const width = typeof window === 'undefined' ? 0 : window.innerWidth;
    const height = typeof window === 'undefined' ? 0 : window.innerHeight;
    if (width <= 0 || height <= 0) return '';
    const ratio = (width / height) / STAGE_ASPECT;
    const visibleWidth = Math.min(100, ratio * 100);
    const visibleHeight = Math.min(100, (1 / ratio) * 100);
    if (visibleWidth >= 99.5 && visibleHeight >= 99.5) return '';
    return `<div class="stage-crop-guide" aria-hidden="true" style="width:${visibleWidth.toFixed(2)}%;height:${visibleHeight.toFixed(2)}%"><span>janela do jogador · ${width}×${height}</span></div>`;
  }

  private lightMarkersTemplate(room: EditorRoom): string {
    return (room.lights ?? []).map((light) => {
      const selected = light.id === this.selectedLightId;
      return `<button class="light-marker ${selected ? 'selected' : ''}" data-role="light-spot" data-light="${esc(light.id)}" style="left:${light.x}%;top:${light.y}%;--light-r:${light.radius}%;--light-color:${esc(light.color ?? '#fffbe8')}" title="Foco de luz — arraste para mover">☀</button>`;
    }).join('');
  }

  private sceneLightingTemplate(room: EditorRoom): string {
    const darkness = room.darknessLevel ?? 0;
    const lights = room.lights ?? [];
    return `<div class="properties-heading"><div><small>CENA</small><h3>${esc(room.name)}</h3></div></div>
      <label><span>Nível de escuridão</span>
        <div class="slider-row"><input type="range" min="0" max="1" step="0.05" data-scene-field="darknessLevel" value="${darkness}" /><b data-role="darkness-readout">${Math.round(darkness * 100)}%</b></div>
      </label>
      <section class="property-section">
        <div class="panel-title"><span>Focos de Luz</span><b>${lights.length}</b></div>
        <p class="panel-hint">Arraste os círculos sobre a imagem para posicionar cada foco. As opções de um foco abrem e fecham <b>somente</b> pelo nome dele, no canto superior do bloco. Os focos precisam de escuridão para aparecer.</p>
        ${lights.map((light, index) => this.lightEntryTemplate(light, index)).join('')}
        <button class="wide-button" data-action="add-light">+ Adicionar foco de luz</button>
      </section>
      ${this.roomAudioTemplate(room)}`;
  }

  /**
   * Música ou efeito que a sala força quando o jogador entra. Enquanto a trilha da
   * sala toca, a trilha do nível fica fora do ar.
   */
  private roomAudioTemplate(room: EditorRoom): string {
    const audio = room.audio;
    const path = audio?.path ?? '';
    const mode: RoomAudioMode = audio?.mode ?? 'every-entry';
    return `<section class="property-section">
      <div class="panel-title"><span>Áudio da sala</span>${path ? '<b>ativo</b>' : ''}</div>
      <label><span>Arquivo</span><input data-room-audio-field="path" list="room-audio-files" value="${esc(path)}" placeholder="/assets/audio/Music/..." /></label>
      <datalist id="room-audio-files">${this.audioFiles.map((file) => `<option value="${esc(file)}"></option>`).join('')}</datalist>
      <p class="panel-hint">${this.audioFiles.length ? `${this.audioFiles.length} arquivos encontrados em public/assets/audio — comece a digitar para filtrar.` : 'Rode <code>npm run audio:manifest</code> para listar os arquivos de public/assets/audio aqui.'}</p>
      ${path ? `<div class="room-audio-modes">${ROOM_AUDIO_MODES.map((entry) => `<label class="check"><input type="checkbox" data-room-audio-field="mode" value="${entry.id}" ${mode === entry.id ? 'checked' : ''} /><span>${esc(entry.label)}<small>${esc(entry.hint)}</small></span></label>`).join('')}</div>
      <label><span>Volume</span><div class="slider-row"><input type="range" min="0" max="1" step="0.05" data-room-audio-field="volume" value="${audio?.volume ?? 1}" /><b data-role="room-audio-volume">${Math.round((audio?.volume ?? 1) * 100)}%</b></div></label>
      <button class="wide-button danger" data-action="clear-room-audio">Remover áudio da sala</button>` : ''}
    </section>`;
  }

  /**
   * Bloco de um foco de luz. Só o botão do nome tem `select-light`: clicar em qualquer
   * campo de configuração não fecha mais o bloco.
   */
  private lightEntryTemplate(light: EditorLight, index: number): string {
    const open = this.selectedLightId === light.id;
    const id = esc(light.id);
    return `<div class="light-entry ${open ? 'active' : ''}">
      <header>
        <button class="light-entry-name" data-action="select-light" data-light="${id}" aria-expanded="${open}" title="Abrir ou fechar as opções deste foco">
          <i style="background:${esc(light.color)}"></i>
          <span>Foco ${String(index + 1).padStart(2, '0')} · ${light.x.toFixed(0)}% ${light.y.toFixed(0)}%</span>
          <em>${open ? '▴' : '▾'}</em>
        </button>
        <button class="danger light-entry-delete" data-action="delete-light" data-light="${id}" aria-label="Excluir foco de luz">×</button>
      </header>
      ${open ? `<div class="light-fields">
        <label><span>Formato</span><select data-light-field="shape" data-light="${id}">${LIGHT_SHAPES.map((shape) => `<option value="${shape.id}" ${light.shape === shape.id ? 'selected' : ''}>${esc(shape.label)}</option>`).join('')}</select></label>
        <label><span>Ângulo visível (abertura)</span><div class="slider-row"><input type="range" min="10" max="360" step="5" data-light-field="aperture" data-light="${id}" value="${light.aperture}" /><b data-role="light-readout" data-readout="aperture:${id}">${Math.round(light.aperture)}°</b></div></label>
        <p class="panel-hint">360° acende o foco inteiro. 180° deixa exatamente meio foco aceso, 90° um quarto, e assim por diante.</p>
        <label><span>Rotação</span><div class="slider-row"><input type="range" min="0" max="359" step="1" data-light-field="angle" data-light="${id}" value="${light.angle}" /><b data-role="light-readout" data-readout="angle:${id}">${Math.round(light.angle)}°</b></div></label>
        <p class="panel-hint" data-role="light-rotation-hint" data-light="${id}" ${light.shape === 'circle' && light.aperture >= 360 ? '' : 'hidden'}>Um círculo inteiro é igual em qualquer rotação: reduza a abertura para escolher o lado aceso.</p>
        <label><span>Raio (%)</span><input type="number" min="2" max="60" step="1" data-light-field="radius" data-light="${id}" value="${light.radius}" /></label>
        <label><span>Intensidade</span><div class="slider-row"><input type="range" min="0.1" max="1" step="0.05" data-light-field="intensity" data-light="${id}" value="${light.intensity}" /><b data-role="light-readout" data-readout="intensity:${id}">${Math.round(light.intensity * 100)}%</b></div></label>
        <label><span>Flickering</span><div class="slider-row"><input type="range" min="0" max="1" step="0.05" data-light-field="flicker" data-light="${id}" value="${light.flicker}" /><b data-role="light-readout" data-readout="flicker:${id}">${Math.round(light.flicker * 100)}%</b></div></label>
        <p class="panel-hint">Flickering em 0% deixa a luz estável; quanto maior, mais ela tremula como uma lâmpada com defeito.</p>
        <label><span>Cor da luz</span><input type="color" data-light-field="color" data-light="${id}" value="${esc(light.color)}" /></label>
      </div>` : ''}
    </div>`;
  }

  private hotspotFieldsTemplate(hotspot: EditorHotspot): string {
    return `<div class="properties-heading"><div><small>HOTSPOT</small><h3>${esc(hotspot.label)}</h3></div><button class="danger" data-action="delete-hotspot">Excluir</button></div>
      <label><span>Etiqueta</span><input data-hotspot-field="label" value="${esc(hotspot.label)}" /></label>
      <label><span>Ação</span><select data-hotspot-field="action"><option value="examine" ${hotspot.action === 'examine' ? 'selected' : ''}>Examinar</option><option value="collect" ${hotspot.action === 'collect' ? 'selected' : ''}>Coletar item</option><option value="use" ${hotspot.action === 'use' ? 'selected' : ''}>Abrir / utilizar</option><option value="event" ${hotspot.action === 'event' ? 'selected' : ''}>Evento / entidade</option><option value="cutscene" ${hotspot.action === 'cutscene' ? 'selected' : ''}>Cutscene</option><option value="hideout" ${hotspot.action === 'hideout' ? 'selected' : ''}>Esconderijo</option></select></label>
      <p class="panel-hint">Para levar o jogador a outra sala, arraste o ponto ◉ do bloco desta sala até a sala de destino no mapa: isso cria um caminho, o único interagível que muda de sala.</p>
      <label><span>Mensagem ao jogador</span><textarea data-hotspot-field="message" rows="4">${esc(hotspot.message)}</textarea></label>
      ${hotspot.action === 'collect' ? `<label><span>Item coletado</span><select data-hotspot-field="item">${this.itemOptions(hotspot.item)}</select></label>` : ''}
      ${hotspot.action === 'use' ? `<label><span>Item necessário</span><select data-hotspot-field="requiresItem"><option value="">Nenhum</option>${this.itemOptions(hotspot.requiresItem)}</select></label>` : ''}
      ${hotspot.action === 'event' ? `<label><span>Evento</span><select data-hotspot-field="event">${this.eventOptions(hotspot.event)}</select></label>` : ''}
      ${hotspot.action === 'cutscene' ? this.cutsceneFieldsTemplate(hotspot) : ''}
      ${hotspot.action === 'hideout' ? this.hideoutFieldsTemplate(hotspot) : ''}
      <div class="field-row"><label><span>Cor do highlight</span><input type="color" data-hotspot-field="highlightColor" value="${esc(hotspot.highlightColor)}" /></label><label><span>Opacidade</span><input type="range" min="0.05" max="0.65" step="0.05" data-hotspot-field="highlightOpacity" value="${hotspot.highlightOpacity}" /></label></div>
      <label class="check"><input type="checkbox" data-hotspot-field="once" ${hotspot.once ? 'checked' : ''} /><span>Executar apenas uma vez</span></label>
      <section class="property-section">
        <div class="panel-title"><span>Visibilidade</span></div>
        <label><span>Estado inicial</span><select data-hotspot-field="visibility"><option value="visible" ${hotspot.visibility === 'visible' ? 'selected' : ''}>Visível</option><option value="hidden" ${hotspot.visibility === 'hidden' ? 'selected' : ''}>Escondido (revela com o tempo)</option><option value="invisible" ${hotspot.visibility === 'invisible' ? 'selected' : ''}>Invisível (revela ao clicar)</option></select></label>
        ${hotspot.visibility === 'hidden' ? `<label><span>Segundos na sala até revelar</span><input type="number" min="1" max="600" data-hotspot-field="revealSeconds" value="${hotspot.revealSeconds}" /></label><p class="panel-hint">Soma o tempo total do jogador nesta sala, mesmo em visitas separadas.</p>` : ''}
        ${hotspot.visibility === 'invisible' ? '<p class="panel-hint">Fica oculto até o jogador clicar na área delimitada; depois disso continua visível.</p>' : ''}
      </section>
      <section class="property-section">
        <div class="panel-title"><span>Círculo visível ao jogador</span></div>
        <p class="panel-hint">O jogador só enxerga este círculo pequeno, nunca a área inteira. Arraste o ponto cheio sobre a imagem para reposicioná-lo; a área toda continua clicável (útil para objetos invisíveis).</p>
      </section>
      <section class="property-section">
        <div class="panel-title"><span>Formato da área clicável</span></div>
        ${hotspot.shapePoints
          ? `<p class="panel-hint">Arraste os pontos amarelos sobre a imagem para ajustar o contorno.</p>
             <label><span>Número de vértices</span><input type="number" min="3" max="24" data-hotspot-field="vertexCount" value="${hotspot.shapePoints.length}" /></label>
             <button class="wide-button" data-action="reset-shape">Voltar para retângulo</button>`
          : `<p class="panel-hint">Por padrão a área é um retângulo/elipse. Converta para um contorno circular com pontos ajustáveis para objetos de forma irregular.</p><button class="wide-button" data-action="make-shape">Usar contorno circular ajustável</button>`}
      </section>
      <div class="coordinate-readout"><span>X <b>${hotspot.x.toFixed(1)}%</b></span><span>Y <b>${hotspot.y.toFixed(1)}%</b></span><span>L <b>${hotspot.width.toFixed(1)}%</b></span><span>A <b>${hotspot.height.toFixed(1)}%</b></span></div>
      <p class="panel-hint">Arraste a área para mover. Use o quadrado no canto inferior direito para redimensionar.</p>`;
  }

  private hideoutFieldsTemplate(hotspot: EditorHotspot): string {
    return `<label><span>Imagem do esconderijo (opcional)</span><div class="input-with-browse"><input data-hotspot-field="hideoutImage" value="${esc(hotspot.hideoutImage ?? '')}" placeholder="/assets/scenes/esconderijo.jpg" /><button type="button" data-action="browse-file" data-target-field="hideoutImage" data-accept="image/*">Procurar</button></div></label>
      ${hotspot.hideoutImage ? `<div class="image-preview"><img src="${esc(hotspot.hideoutImage)}" alt="Prévia do esconderijo" /><span>${esc(hotspot.hideoutImage)}</span></div>` : ''}
      <p class="panel-hint">O jogador vê esta imagem enquanto está escondido. Deixe em branco para mostrar apenas texto.</p>`;
  }

  private cutsceneFieldsTemplate(hotspot: EditorHotspot): string {
    return `<label><span>Tipo de mídia</span><select data-hotspot-field="cutsceneMedia">
        <option value="image" ${hotspot.cutsceneMedia === 'image' ? 'selected' : ''}>Imagem estática</option>
        <option value="gif" ${hotspot.cutsceneMedia === 'gif' ? 'selected' : ''}>GIF animado</option>
        <option value="video" ${hotspot.cutsceneMedia === 'video' ? 'selected' : ''}>Vídeo</option>
      </select></label>
      <label><span>Caminho do arquivo</span><div class="input-with-browse"><input data-hotspot-field="cutscenePath" value="${esc(hotspot.cutscenePath)}" placeholder="/assets/cutscenes/exemplo.jpg" /><button type="button" data-action="browse-file" data-target-field="cutscenePath" data-accept="image/*,video/*,.gif">Procurar</button></div></label>
      ${hotspot.cutsceneMedia === 'image'
        ? `<label><span>Duração (segundos)</span><input type="number" min="0.2" step="0.1" data-hotspot-field="cutsceneHoldSeconds" value="${hotspot.cutsceneHoldSeconds}" /></label>`
        : `<label><span>Repetições</span><input type="number" min="1" max="100" data-hotspot-field="cutsceneRepeatCount" value="${hotspot.cutsceneRepeatCount}" /></label>
           ${hotspot.cutsceneMedia === 'gif' ? `<label><span>Duração estimada de uma repetição (s)</span><input type="number" min="0.2" step="0.1" data-hotspot-field="cutsceneHoldSeconds" value="${hotspot.cutsceneHoldSeconds}" /></label><p class="panel-hint">GIFs não avisam quando terminam um laço; esse valor estima a duração de cada repetição.</p>` : '<p class="panel-hint">O vídeo avança a repetição sozinho ao terminar.</p>'}`}
      <p class="panel-hint">Cutscenes não são puláveis pelo jogador.</p>`;
  }

  private itemsPanelTemplate(): string {
    const items = this.project.data.items;
    const item = this.selectedItem ?? items[0];
    return `<div class="side-panel-layout">
      <aside class="editor-sidebar editor-left">
        <section><div class="panel-title"><span>Itens</span><b>${items.length}</b></div>
          <div class="level-list">${items.map((entry) => `<button class="${entry.id === item?.id ? 'active' : ''}" data-action="select-item" data-item="${esc(entry.id)}"><i></i><span>${esc(entry.icon)} ${esc(entry.name)}</span><small>${esc(entry.effect)}</small></button>`).join('')}</div>
          <button class="wide-button primary" data-action="new-item">+ Novo item</button>
        </section>
      </aside>
      <section class="editor-properties-wide">
        ${item ? this.itemFieldsTemplate(item) : '<p class="empty-note">Nenhum item criado.</p>'}
      </section>
    </div>`;
  }

  private itemFieldsTemplate(item: EditorItem): string {
    return `<div class="properties-heading"><div><small>ITEM</small><h2>${esc(item.name)}</h2></div><button class="danger" data-action="delete-item" data-item="${esc(item.id)}" ${this.project.data.items.length <= 1 ? 'disabled' : ''}>Excluir</button></div>
      <label><span>Nome</span><input data-item-field="name" value="${esc(item.name)}" /></label>
      <label><span>Ícone (texto/emoji)</span><input data-item-field="icon" value="${esc(item.icon)}" maxlength="4" /></label>
      <label><span>Imagem (opcional, substitui o ícone)</span><div class="input-with-browse"><input data-item-field="image" value="${esc(item.image ?? '')}" placeholder="/assets/items/exemplo.png" /><button type="button" data-action="browse-file" data-target-field="item-image" data-accept="image/*">Procurar</button></div></label>
      ${item.image ? `<div class="image-preview"><img src="${esc(item.image)}" alt="Prévia de ${esc(item.name)}" /><span>${esc(item.image)}</span></div>` : ''}
      <label><span>Descrição</span><textarea data-item-field="description" rows="3">${esc(item.description)}</textarea></label>
      <label><span>Texto ao usar</span><textarea data-item-field="useText" rows="2">${esc(item.useText)}</textarea></label>
      <label><span>Efeito ao usar</span><select data-item-field="effect"><option value="none" ${item.effect === 'none' ? 'selected' : ''}>Nenhum (item de cenário)</option><option value="heal" ${item.effect === 'heal' ? 'selected' : ''}>Cura vida</option><option value="hydrate" ${item.effect === 'hydrate' ? 'selected' : ''}>Mata a sede</option><option value="feed" ${item.effect === 'feed' ? 'selected' : ''}>Mata a fome</option></select></label>
      ${item.effect !== 'none' ? `<label><span>Quantidade recuperada</span><input type="number" min="1" max="100" data-item-field="effectAmount" value="${item.effectAmount}" /></label>` : ''}
      <p class="panel-hint">ID interno: <code>${esc(item.id)}</code></p>`;
  }

  private entitiesPanelTemplate(): string {
    const entities = this.project.data.entities;
    const entity = this.selectedEntity ?? entities[0];
    return `<div class="side-panel-layout">
      <aside class="editor-sidebar editor-left">
        <section><div class="panel-title"><span>Entidades</span><b>${entities.length}</b></div>
          <div class="level-list">${entities.map((entry) => `<button class="${entry.id === entity?.id ? 'active' : ''}" data-action="select-entity" data-entity="${esc(entry.id)}"><i></i><span>${esc(entry.name)}</span><small>${entry.solution === 'hide' ? 'esconder-se' : 'correr'}</small></button>`).join('')}</div>
          <button class="wide-button primary" data-action="new-entity">+ Nova entidade</button>
        </section>
      </aside>
      <section class="editor-properties-wide">
        ${entity ? this.entityFieldsTemplate(entity) : '<p class="empty-note">Nenhuma entidade criada.</p>'}
      </section>
    </div>`;
  }

  private entityFieldsTemplate(entity: EditorEntity): string {
    return `<div class="properties-heading"><div><small>ENTIDADE</small><h2>${esc(entity.name)}</h2></div><button class="danger" data-action="delete-entity" data-entity="${esc(entity.id)}" ${this.project.data.entities.length <= 1 ? 'disabled' : ''}>Excluir</button></div>
      <label><span>Nome</span><input data-entity-field="name" value="${esc(entity.name)}" /></label>
      <label><span>Mensagem do encontro</span><textarea data-entity-field="prompt" rows="2">${esc(entity.prompt)}</textarea></label>
      <label><span>Dica</span><textarea data-entity-field="hint" rows="2">${esc(entity.hint)}</textarea></label>
      <label><span>Decisão correta</span><select data-entity-field="solution"><option value="hide" ${entity.solution === 'hide' ? 'selected' : ''}>Esconder-se</option><option value="run" ${entity.solution === 'run' ? 'selected' : ''}>Correr</option></select></label>
      <label><span>Tempo para decidir (segundos)</span><input type="number" min="1" max="30" step="0.1" data-entity-field="timeLimit" value="${entity.timeLimit}" /></label>
      <label><span>Imagem relativa</span><div class="input-with-browse"><input data-entity-field="image" list="entity-assets" value="${esc(entity.image)}" /><button type="button" data-action="browse-file" data-target-field="entity-image" data-accept="image/*,.gif">Procurar</button></div></label>
      <datalist id="entity-assets">${ENTITY_IMAGE_LIBRARY.map((image) => `<option value="${esc(image)}"></option>`).join('')}</datalist>
      <div class="image-preview"><img src="${esc(entity.image)}" alt="Prévia de ${esc(entity.name)}" /><span>${esc(entity.image)}</span></div>
      <label><span>Duração do jumpscare (segundos, padrão 1.55)</span><input type="number" min="0.3" max="10" step="0.05" data-entity-field="jumpscareSeconds" value="${entity.jumpscareSeconds ?? ''}" placeholder="1.55" /></label>
      <p class="panel-hint">ID interno: <code>${esc(entity.id)}</code> · use este ID no campo "Evento" de um hotspot para disparar o encontro.</p>`;
  }

  private itemOptions(selected?: string): string { return this.project.data.items.map((item) => `<option value="${esc(item.id)}" ${selected === item.id ? 'selected' : ''}>${esc(item.name)}</option>`).join(''); }

  private eventOptions(selected?: string): string {
    const entities = this.project.data.entities.map((entity) => `<option value="${esc(entity.id)}" ${selected === entity.id ? 'selected' : ''}>${esc(entity.name)}</option>`).join('');
    return `${entities}<option value="jumpscare" ${selected === 'jumpscare' ? 'selected' : ''}>Jumpscare direto</option>`;
  }

  /**
   * Para onde um caminho leva: primeiro o nível, depois a sala. Escolher outro nível
   * troca a lista de salas para as daquele nível, e o destino pode atravessar níveis.
   * Só uma conexão tem destino: nenhum interagível muda de sala por conta própria.
   */
  private destinationFields(levelId: string, roomId: string | undefined, excludeRoomId: string, connectionId: string): string {
    const levels = this.project.data.levels;
    const target = levels.find((entry) => entry.id === levelId) ?? this.project.activeLevel;
    const sameLevel = target.id === this.project.activeLevel.id;
    const rooms = target.rooms.filter((room) => !sameLevel || room.id !== excludeRoomId);
    const attr = (field: string) => `data-connection-field="${field}" data-connection="${esc(connectionId)}"`;
    const levelOptions = levels.map((entry) => `<option value="${esc(entry.id)}" ${entry.id === target.id ? 'selected' : ''}>${esc(entry.name)}${entry.id === this.project.activeLevel.id ? ' (aberto)' : ''}</option>`).join('');
    const roomOptions = rooms.map((room) => `<option value="${esc(room.id)}" ${room.id === roomId ? 'selected' : ''}>${esc(room.name)}</option>`).join('')
      || '<option value="">Este nível não tem outra sala</option>';
    return `<label><span>Nível de destino</span><select ${attr('toLevelId')}>${levelOptions}</select></label>
      <label><span>Sala de destino</span><select ${attr('to')}>${roomOptions}</select></label>
      ${sameLevel ? '' : '<p class="panel-hint">Este caminho atravessa para outro nível. O jogo carrega todos os níveis juntos, então a passagem funciona direto.</p>'}`;
  }

  private playtestTemplate(): string {
    const game = this.testGame;
    if (!game) return '';
    const room = game.room;
    const exits = Object.entries(room.exits);
    const jump = performance.now() < this.testJumpscareUntil;
    const items = itemsToRuntime(this.project.data.items);
    return `<main class="editor-playtest">
      <section class="test-scene">
        <div class="test-scene-frame">
          <img src="${esc(room.image)}" alt="${esc(room.description)}" />
          ${this.testHotspotMarkup(game, room)}
        </div>
        <div class="test-grade"></div>
      </section>
      <header class="test-header"><div><small>${esc(room.code)}</small><strong>${esc(room.name)}</strong></div><nav><button data-test-action="inventory">Inventário (${game.inventory.reduce((sum, item) => sum + item.quantity, 0)})</button><button data-test-action="exit">Voltar ao editor</button></nav></header>
      <div class="test-stats">${this.testStat('health', 'Vida', game.stats.health)}${this.testStat('thirst', 'Sede', game.stats.thirst)}${this.testStat('hunger', 'Fome', game.stats.hunger)}${this.testStat('anxiety', 'Ansiedade', game.stats.anxiety)}</div>
      <nav class="test-exits">${exits.map(([direction, exit]) => `<button data-test-action="move" data-direction="${esc(direction)}"><i>↗</i><span>${esc(exit.label)}</span>${exit.requiresItem ? `<small>requer ${esc(items[exit.requiresItem]?.name ?? exit.requiresItem)}</small>` : ''}</button>`).join('') || '<span class="dead-end">Sem saídas configuradas</span>'}</nav>
      <div class="test-message">${esc(game.message)}</div>
      ${this.testInventoryOpen ? this.testInventoryTemplate() : ''}
      ${game.encounter ? this.testEncounterTemplate() : ''}
      ${game.status === 'cutscene' ? this.testCutsceneTemplate(game) : ''}
      ${game.status === 'gameover' ? '<div class="test-modal"><section><small>FIM DO TESTE</small><h2>O jogador não sobreviveu</h2><button data-test-action="restart">Reiniciar nesta sala</button><button data-test-action="exit">Voltar ao editor</button></section></div>' : ''}
      ${jump ? `<div class="test-jumpscare"><img src="${esc(game.encounter?.image ?? this.project.data.entities[0]?.image ?? '')}" alt="Entidade atacando" /></div>` : ''}
      <div class="test-badge">MODO DE TESTE · alterações não afetam o mapa</div>
    </main>`;
  }

  private testHotspotMarkup(game: Game, room: RoomDefinition): string {
    return room.hotspots.map((hotspot) => {
      const onceUsed = hotspot.once && game.flags[`hotspot:${room.id}:${hotspot.id}`];
      if (onceUsed) return '';
      const revealed = Boolean(game.flags[`reveal:${room.id}:${hotspot.id}`]);
      if (hotspot.visibility === 'hidden' && !revealed) return '';
      const clip = hotspot.shape ? `clip-path:polygon(${hotspot.shape.points.map((point) => `${point.x}% ${point.y}%`).join(',')});` : '';
      const invisible = hotspot.visibility === 'invisible' && !revealed;
      const indicator = hotspot.indicator ?? { x: 50, y: 50 };
      const label = labelAnchorOf(hotspot);
      const markerStyle = `left:${indicator.x}%;top:${indicator.y}%;--highlight:${esc(hotspot.highlight?.color ?? '#d7df77')};--highlight-strength:${(hotspot.highlight?.opacity ?? .22) * 100}%`;
      const marker = `<i class="test-hotspot-marker${invisible ? ' invisible-hotspot' : ''}" style="${markerStyle}"></i>`;
      return `<div class="test-hotspot-group${invisible ? ' hotspot-invisible' : ''}" style="left:${hotspot.x}%;top:${hotspot.y}%;width:${hotspot.width}%;height:${hotspot.height}%">
        <button class="test-hotspot-hitbox${invisible ? ' hotspot-invisible-hitbox' : ''}" data-test-action="hotspot" data-hotspot="${esc(hotspot.id)}" style="${clip}" aria-label="${esc(hotspot.label)}"></button>
        ${marker}
        <span class="test-hotspot-label" style="left:${label.x}%;top:${label.y}%">${esc(hotspot.label)}</span>
      </div>`;
    }).join('');
  }

  private testStat(key: string, label: string, value: number): string { return `<div data-test-stat="${key}"><span>${label}</span><b>${Math.round(value)}</b><i><em style="width:${value}%"></em></i></div>`; }

  private testInventoryTemplate(): string {
    const game = this.testGame!;
    const items = itemsToRuntime(this.project.data.items);
    const slots = game.inventory.flatMap((entry) => {
      const def = items[entry.id];
      return def ? [{ entry, def }] : [];
    });
    return `<div class="test-inventory"><section><header><div><small>INVENTÁRIO DO TESTE</small><h2>Itens coletados</h2></div><button data-test-action="inventory">×</button></header><div class="test-item-grid">${slots.map(({ entry, def }) => `<button class="${game.selectedItem === entry.id ? 'selected' : ''}" data-test-action="use-item" data-item="${entry.id}"><i>${def.image ? `<img src="${def.image}" alt="" />` : def.icon}</i><span>${esc(def.name)}</span><b>${entry.quantity}</b></button>`).join('') || '<p>Nenhum item coletado.</p>'}</div><p>Consumíveis são usados imediatamente. Ferramentas ficam selecionadas para uso em hotspots.</p></section></div>`;
  }

  private testEncounterTemplate(): string {
    const encounter = this.testGame!.encounter!;
    return `<div class="test-encounter"><img src="${esc(encounter.image)}" alt="${esc(encounter.name)}" /><section><small>DECISÃO RÁPIDA</small><h2>${esc(encounter.name)}</h2><p>${esc(encounter.prompt)}</p><em>${esc(encounter.hint)}</em><div class="test-timer"><i style="width:${(encounter.remaining / encounter.timeLimit) * 100}%"></i></div><nav><button data-test-action="encounter" data-choice="run">Correr</button><button data-test-action="encounter" data-choice="hide">Esconder-se</button></nav></section></div>`;
  }

  private testCutsceneTemplate(game: Game): string {
    const cutscene = game.cutscene;
    if (!cutscene) return '';
    const progress = cutscene.mediaType === 'image'
      ? (cutscene.holdSeconds > 0 ? cutscene.elapsed / cutscene.holdSeconds : 1)
      : (cutscene.repeatCount > 0 ? cutscene.loopsCompleted / cutscene.repeatCount : 1);
    const media = cutscene.mediaType === 'video'
      ? `<video src="${esc(cutscene.mediaPath)}" autoplay muted playsinline data-role="test-cutscene-video"></video>`
      : `<img src="${esc(cutscene.mediaPath)}" alt="Cena" />`;
    return `<div class="test-cutscene"><div class="test-cutscene-media">${media}</div><div class="test-cutscene-progress"><i style="width:${Math.min(100, Math.max(0, progress * 100))}%"></i></div></div>`;
  }

  private bindTestCutsceneVideo(): void {
    const video = this.root.querySelector<HTMLVideoElement>('[data-role="test-cutscene-video"]');
    if (!video) return;
    video.onended = () => {
      this.testGame?.advanceCutsceneLoop();
      this.lastTestKey = '';
      this.render();
    };
  }

  private bindEvents(): void {
    this.root.addEventListener('click', (event) => void this.handleClick(event));
    this.root.addEventListener('dblclick', (event) => this.handleDoubleClick(event));
    this.root.addEventListener('change', (event) => void this.handleChange(event));
    // Luz e escuridão têm prévia ao vivo enquanto o controle é arrastado.
    this.root.addEventListener('input', (event) => {
      const input = event.target as HTMLInputElement;
      if (input.dataset?.lightField) this.applyLightField(input, false);
      else if (input.dataset?.sceneField) this.applySceneField(input);
      else if (input.dataset?.roomAudioField === 'volume') {
        const readout = this.root.querySelector<HTMLElement>('[data-role="room-audio-volume"]');
        if (readout) readout.textContent = `${Math.round(Number(input.value) * 100)}%`;
      }
    });
    this.root.addEventListener('pointerdown', (event) => this.handlePointerDown(event));
    this.root.addEventListener('wheel', (event) => this.handleWheel(event), { passive: false });
    window.addEventListener('pointermove', (event) => this.handlePointerMove(event));
    window.addEventListener('pointerup', (event) => this.handlePointerUp(event));
    window.addEventListener('keydown', (event) => this.handleKey(event));
  }

  /** Ctrl+C e Ctrl+V sobre o que estiver selecionado, exceto dentro de um campo. */
  private handleKey(event: KeyboardEvent): void {
    if (this.testMode || !(event.ctrlKey || event.metaKey)) return;
    // O alvo pode não ser um elemento (teclado sem foco): só então vale o atalho.
    const target = event.target as Element | null;
    if (target && typeof target.closest === 'function' && target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const key = event.key.toLowerCase();
    if (key !== 'c' && key !== 'v') return;
    event.preventDefault();
    if (key === 'c') this.copySelection();
    else void this.pasteClipboard();
  }

  /** O que o Ctrl+C leva, na ordem do que está em foco agora. */
  private copySelection(): void {
    const room = this.selectedRoom;
    if (this.hotspotEditorOpen && room) {
      const hotspot = room.hotspots.find((entry) => entry.id === this.selectedHotspotId);
      if (hotspot) return this.remember({ kind: 'hotspot', data: structuredClone(hotspot) });
      const light = room.lights?.find((entry) => entry.id === this.selectedLightId);
      if (light) return this.remember({ kind: 'light', data: structuredClone(light) });
    }
    if (this.activePanel === 'items' && this.selectedItem) return this.remember({ kind: 'item', data: structuredClone(this.selectedItem) });
    if (this.activePanel === 'entities' && this.selectedEntity) return this.remember({ kind: 'entity', data: structuredClone(this.selectedEntity) });
    if (room) return this.remember({ kind: 'room', data: structuredClone(room) });
    this.flashClipboard('Nada selecionado para copiar.');
  }

  private remember(entry: ClipboardEntry): void {
    this.clipboard = entry;
    this.flashClipboard(`${CLIPBOARD_LABELS[entry.kind]} copiado — Ctrl+V para colar`);
  }

  /** Cola uma cópia independente, com id próprio, no lugar que faz sentido para ela. */
  private async pasteClipboard(): Promise<void> {
    const entry = this.clipboard;
    if (!entry) { this.flashClipboard('A área de transferência do editor está vazia.'); return; }
    const { createId } = await import('./EditorProject');
    const room = this.selectedRoom;
    if (entry.kind === 'hotspot') {
      if (!room) return;
      const hotspot: EditorHotspot = { ...structuredClone(entry.data), id: createId('hotspot') };
      hotspot.label = `${hotspot.label} (cópia)`;
      hotspot.x = clamp(hotspot.x + 4, -100, 100);
      hotspot.y = clamp(hotspot.y + 4, -100, 100);
      room.hotspots.push(hotspot);
      this.selectedHotspotId = hotspot.id;
      this.selectedConnectionId = null;
      this.hotspotEditorOpen = true;
    } else if (entry.kind === 'light') {
      if (!room) return;
      const light: EditorLight = { ...structuredClone(entry.data), id: createId('luz') };
      light.x = clamp(light.x + 4, 0, 100);
      light.y = clamp(light.y + 4, 0, 100);
      room.lights = [...(room.lights ?? []), light];
      this.selectedLightId = light.id;
      this.selectedHotspotId = null;
      this.hotspotEditorOpen = true;
    } else if (entry.kind === 'room') {
      const copy: EditorRoom = structuredClone(entry.data);
      copy.id = createId('sala');
      copy.name = `${copy.name} — cópia`;
      copy.position = { x: copy.position.x + 48, y: copy.position.y + 48 };
      copy.hotspots = copy.hotspots.map((hotspot) => ({ ...hotspot, id: createId('hotspot') }));
      copy.lights = copy.lights?.map((light) => ({ ...light, id: createId('luz') }));
      this.project.activeLevel.rooms.push(copy);
      this.selectedRoomId = copy.id;
    } else if (entry.kind === 'item') {
      const item: EditorItem = { ...structuredClone(entry.data), id: createId('item') };
      item.name = `${item.name} (cópia)`;
      this.project.data.items.push(item);
      this.selectedItemId = item.id;
      this.activePanel = 'items';
    } else {
      const entity: EditorEntity = { ...structuredClone(entry.data), id: createId('entidade') };
      entity.name = `${entity.name} (cópia)`;
      this.project.data.entities.push(entity);
      this.selectedEntityId = entity.id;
      this.activePanel = 'entities';
    }
    this.project.save();
    this.flashClipboard(`${CLIPBOARD_LABELS[entry.kind]} colado`);
  }

  private flashClipboard(note: string): void {
    this.clipboardNote = note;
    this.render();
    window.setTimeout(() => {
      if (this.clipboardNote !== note) return;
      this.clipboardNote = '';
      if (!this.testMode) this.render();
    }, 2600);
  }

  private async handleClick(event: MouseEvent): Promise<void> {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action], [data-test-action]');
    if (!target || target.matches(':disabled')) return;
    if (target.dataset.testAction) { await this.handleTestAction(target.dataset.testAction, target.dataset); return; }
    const action = target.dataset.action;
    if (!action) return;
    switch (action) {
      case 'confirm-accept': { const request = this.confirm; this.confirm = null; request?.run(); break; }
      case 'confirm-cancel': this.confirm = null; break;
      case 'panel-map': this.activePanel = 'map'; break;
      case 'panel-items': this.activePanel = 'items'; if (!this.selectedItemId) this.selectedItemId = this.project.data.items[0]?.id ?? null; break;
      case 'panel-entities': this.activePanel = 'entities'; if (!this.selectedEntityId) this.selectedEntityId = this.project.data.entities[0]?.id ?? null; break;
      case 'select-item': this.selectedItemId = target.dataset.item ?? null; break;
      case 'new-item': { const item = this.project.addItem(); this.selectedItemId = item.id; break; }
      case 'delete-item': {
        const id = target.dataset.item ?? '';
        const item = this.project.findItem(id);
        if (!item) break;
        this.askConfirm({
          title: `Excluir "${item.name}"`,
          message: 'O item sai do projeto e de todos os interagíveis que pediam por ele.',
          confirmLabel: 'Excluir item',
          run: () => {
            if (this.project.deleteItem(id)) this.selectedItemId = this.project.data.items[0]?.id ?? null;
            this.render();
          },
        });
        return;
      }
      case 'select-entity': this.selectedEntityId = target.dataset.entity ?? null; break;
      case 'new-entity': { const entity = this.project.addEntity(); this.selectedEntityId = entity.id; break; }
      case 'delete-entity': {
        const id = target.dataset.entity ?? '';
        const entity = this.project.findEntity(id);
        if (!entity) break;
        this.askConfirm({
          title: `Excluir "${entity.name}"`,
          message: 'A entidade sai do projeto e dos interagíveis que a disparavam.',
          confirmLabel: 'Excluir entidade',
          run: () => {
            if (this.project.deleteEntity(id)) this.selectedEntityId = this.project.data.entities[0]?.id ?? null;
            this.render();
          },
        });
        return;
      }
      case 'select-level': this.selectLevel(target.dataset.level ?? ''); break;
      case 'select-room': this.selectedRoomId = target.dataset.room ?? this.selectedRoomId; this.selectedHotspotId = null; this.selectedConnectionId = null; if (event.detail >= 2) this.openPerspective(); break;
      case 'new-room': { const room = this.project.addRoom(); this.selectedRoomId = room.id; break; }
      case 'new-level': {
        // Um nível novo nasce vazio, com uma sala só e nenhuma conexão antiga.
        const level = this.project.addLevel();
        this.activePanel = 'map';
        this.selectedRoomId = level.startRoomId;
        this.selectedHotspotId = null;
        this.selectedConnectionId = null;
        this.selectedLightId = null;
        this.hotspotEditorOpen = false;
        this.resetView();
        break;
      }
      case 'rename-level': {
        const id = target.dataset.level ?? '';
        const current = this.project.findLevel(id);
        if (!current) break;
        const name = window.prompt('Novo nome do nível:', current.name);
        if (name) this.project.renameLevel(id, name);
        break;
      }
      case 'delete-level': {
        const id = target.dataset.level ?? '';
        const current = this.project.findLevel(id);
        if (!current) break;
        if (this.project.data.levels.length <= 1) {
          this.askConfirm({
            title: 'Este é o único nível',
            message: 'O projeto precisa de pelo menos um nível. Crie outro antes de excluir este.',
            confirmLabel: 'Entendi',
            run: () => this.render(),
          });
          return;
        }
        this.askConfirm({
          title: `Excluir o nível "${current.name}"`,
          message: `${current.rooms.length} ${current.rooms.length === 1 ? 'sala' : 'salas'} e os caminhos que levavam até elas serão removidos. Isso não pode ser desfeito.`,
          confirmLabel: 'Excluir nível',
          run: () => {
            if (this.project.deleteLevel(id)) this.selectLevel(this.project.activeLevel.id);
            this.render();
          },
        });
        return;
      }
      case 'clear-room-audio': { const room = this.selectedRoom; if (room) { room.audio = undefined; this.project.save(); } break; }
      case 'duplicate-room': { const room = this.project.duplicateRoom(this.selectedRoomId); if (room) this.selectedRoomId = room.id; break; }
      case 'delete-room': {
        const room = this.selectedRoom;
        if (!room) break;
        this.askConfirm({
          title: `Excluir a sala "${room.name}"`,
          message: 'Os caminhos que entram e saem desta sala vão junto.',
          confirmLabel: 'Excluir sala',
          run: () => {
            if (this.project.deleteRoom(room.id)) this.selectedRoomId = this.project.activeLevel.startRoomId;
            this.render();
          },
        });
        return;
      }
      case 'set-start': this.project.activeLevel.startRoomId = this.selectedRoomId; this.project.save(); break;
      case 'set-exit': this.project.activeLevel.escapeRoomId = this.selectedRoomId; this.project.save(); break;
      case 'delete-connection': this.project.deleteConnection(target.dataset.connection ?? ''); this.selectedConnectionId = null; break;
      case 'reset-connection-button': { const connection = this.project.activeLevel.connections.find((entry) => entry.id === target.dataset.connection); if (connection) { connection.buttonX = undefined; connection.buttonY = undefined; connection.arrowRotation = undefined; this.project.save(); } break; }
      case 'save': this.project.save(); break;
      case 'choose-image': if (this.selectedRoom) { this.selectedRoom.image = target.dataset.image ?? this.selectedRoom.image; this.project.save(); } break;
      case 'open-hotspots': this.openPerspective(); break;
      case 'open-hotspot': this.hotspotEditorOpen = true; this.selectedHotspotId = target.dataset.hotspot ?? null; this.selectedConnectionId = null; break;
      case 'scene-lighting': this.selectedHotspotId = null; this.selectedConnectionId = null; this.selectedLightId = null; break;
      case 'select-scene-connection': this.selectedConnectionId = target.dataset.connection ?? null; this.selectedHotspotId = null; break;
      case 'close-hotspots': this.hotspotEditorOpen = false; this.selectedHotspotId = null; this.selectedConnectionId = null; this.selectedLightId = null; this.project.save(); break;
      case 'add-hotspot': if (this.selectedRoom) { const hotspot = this.project.addHotspot(this.selectedRoom.id); this.selectedHotspotId = hotspot?.id ?? null; this.selectedConnectionId = null; } break;
      case 'delete-hotspot': {
        const room = this.selectedRoom;
        const hotspotId = this.selectedHotspotId;
        const hotspot = room?.hotspots.find((entry) => entry.id === hotspotId);
        if (!room || !hotspotId || !hotspot) break;
        this.askConfirm({
          title: `Excluir "${hotspot.label}"`,
          message: 'O interagível sai desta perspectiva.',
          confirmLabel: 'Excluir interagível',
          run: () => {
            this.project.deleteHotspot(room.id, hotspotId);
            this.selectedHotspotId = room.hotspots[0]?.id ?? null;
            this.render();
          },
        });
        return;
      }
      case 'make-shape': { const hotspot = this.selectedRoom?.hotspots.find((entry) => entry.id === this.selectedHotspotId); if (hotspot) { hotspot.shapePoints = circlePoints(); this.project.save(); } break; }
      case 'reset-shape': { const hotspot = this.selectedRoom?.hotspots.find((entry) => entry.id === this.selectedHotspotId); if (hotspot) { hotspot.shapePoints = undefined; this.project.save(); } break; }
      case 'add-light': {
        const room = this.selectedRoom;
        if (room) {
          if (!room.lights) room.lights = [];
          const { createId } = await import('./EditorProject');
          const light = createLight(createId('luz'));
          room.lights.push(light);
          this.selectedLightId = light.id;
          this.project.save();
        }
        break;
      }
      case 'delete-light': {
        const room = this.selectedRoom;
        const lightId = target.dataset.light;
        if (room && lightId) {
          room.lights = (room.lights ?? []).filter((l) => l.id !== lightId);
          if (this.selectedLightId === lightId) this.selectedLightId = null;
          this.project.save();
        }
        break;
      }
      case 'select-light': {
        const lightId = target.dataset.light;
        this.selectedLightId = this.selectedLightId === lightId ? null : (lightId ?? null);
        break;
      }
      case 'zoom-in': this.setZoom(this.zoom + .12); break;
      case 'zoom-out': this.setZoom(this.zoom - .12); break;
      case 'reset-view': this.resetView(); break;
      case 'browse-file': {
        this.browseTarget = target.dataset.targetField ?? '';
        const accept = target.dataset.accept ?? 'image/*';
        const role = accept.includes('video') ? 'browse-media' : 'browse-image';
        const input = this.root.querySelector<HTMLInputElement>(`[data-role="${role}"]`);
        if (input) { input.accept = accept; input.click(); }
        return;
      }
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
    if ((input.matches('[data-role="browse-image"]') || input.matches('[data-role="browse-media"]')) && input instanceof HTMLInputElement && input.files?.[0]) {
      const file = input.files[0];
      const objectUrl = await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      });
      if (objectUrl === null) { input.value = ''; this.browseTarget = ''; window.alert('Não foi possível ler este arquivo.'); return; }
      const target = this.browseTarget;
      if (target === 'room-image' && this.selectedRoom) { this.selectedRoom.image = objectUrl; this.project.save(); }
      else if (target === 'item-image' && this.selectedItem) { this.selectedItem.image = objectUrl; this.project.save(); }
      else if (target === 'entity-image' && this.selectedEntity) { this.selectedEntity.image = objectUrl; this.project.save(); }
      else if (target === 'cutscenePath') {
        const hotspot = this.selectedRoom?.hotspots.find((entry) => entry.id === this.selectedHotspotId);
        if (hotspot) { hotspot.cutscenePath = objectUrl; hotspot.cutsceneMedia = detectMediaType(file.name); this.project.save(); }
      } else if (target === 'hideoutImage') {
        const hotspot = this.selectedRoom?.hotspots.find((entry) => entry.id === this.selectedHotspotId);
        if (hotspot) { hotspot.hideoutImage = objectUrl; this.project.save(); }
      }
      input.value = '';
      this.browseTarget = '';
      this.render();
      return;
    }
    if (input.dataset.levelField === 'name') {
      this.project.renameLevel(input.dataset.level ?? this.project.activeLevel.id, input.value);
      this.render();
      return;
    }
    if (input.dataset.roomAudioField) { this.applyRoomAudioField(input); return; }
    const roomField = input.dataset.roomField as keyof Pick<EditorRoom, 'name' | 'code' | 'description' | 'image'> | undefined;
    if (roomField && this.selectedRoom) { this.selectedRoom[roomField] = input.value; this.project.save(); this.render(); return; }
    const itemField = input.dataset.itemField as keyof EditorItem | undefined;
    if (itemField && this.selectedItem) {
      const item = this.selectedItem;
      if (itemField === 'effectAmount') item.effectAmount = Number(input.value);
      else if (itemField === 'effect') item.effect = input.value as EditorItem['effect'];
      else if (itemField === 'image') item.image = input.value || undefined;
      else if (itemField === 'name' || itemField === 'icon' || itemField === 'description' || itemField === 'useText') item[itemField] = input.value;
      this.project.save(); this.render();
      return;
    }
    const entityField = input.dataset.entityField as keyof EditorEntity | undefined;
    if (entityField && this.selectedEntity) {
      const entity = this.selectedEntity;
      if (entityField === 'timeLimit') entity.timeLimit = Number(input.value);
      else if (entityField === 'jumpscareSeconds') entity.jumpscareSeconds = input.value ? Number(input.value) : undefined;
      else if (entityField === 'solution') entity.solution = input.value as EncounterAction;
      else if (entityField === 'name' || entityField === 'prompt' || entityField === 'hint' || entityField === 'image') entity[entityField] = input.value;
      this.project.save(); this.render();
      return;
    }
    const connectionId = input.dataset.connection;
    const connectionField = input.dataset.connectionField as keyof EditorConnection | 'buttonX' | 'buttonY' | 'arrowRotation' | undefined;
    if (connectionId && connectionField) {
      const connection = this.project.activeLevel.connections.find((entry) => entry.id === connectionId);
      if (connection) {
        if (connectionField === 'bidirectional') connection.bidirectional = (input as HTMLInputElement).checked;
        else if (connectionField === 'requiresItem') connection.requiresItem = input.value ? input.value as ItemId : undefined;
        else if (connectionField === 'buttonX' || connectionField === 'buttonY') connection[connectionField] = clamp(Number(input.value), 0, 100);
        else if (connectionField === 'arrowRotation') connection.arrowRotation = ((Number(input.value) % 360) + 360) % 360;
        else if (connectionField === 'direction') {
          if (['forward', 'back', 'left', 'right'].includes(input.value)) {
            connection.direction = input.value;
            connection.arrowRotation = defaultArrowRotation(input.value);
          } else {
            connection.direction = 'custom';
          }
        } else if ((connectionField as string) === 'customDirection') { connection.direction = input.value; }
        else if ((connectionField as string) === 'toLevelId') {
          // Trocar o nível de destino também troca a sala: a antiga pode nem existir lá.
          const level = this.project.findLevel(input.value);
          connection.toLevelId = level && level.id !== this.project.activeLevel.id ? level.id : undefined;
          const rooms = (level ?? this.project.activeLevel).rooms.filter((room) => room.id !== connection.from);
          if (rooms[0]) connection.to = rooms[0].id;
          if (connection.toLevelId) connection.bidirectional = false;
        }
        else if (connectionField === 'label' || connectionField === 'lockedMessage' || connectionField === 'to') connection[connectionField] = input.value;
        this.project.save(); this.render();
      }
      return;
    }
    if (input.dataset.sceneField) { this.applySceneField(input); return; }
    if (input.dataset.lightField) { this.applyLightField(input, true); return; }
    const hotspotField = input.dataset.hotspotField as keyof EditorHotspot | 'vertexCount' | undefined;
    const hotspot = this.selectedRoom?.hotspots.find((entry) => entry.id === this.selectedHotspotId);
    if (hotspotField && hotspot) {
      if (hotspotField === 'once') hotspot.once = (input as HTMLInputElement).checked;
      else if (hotspotField === 'highlightOpacity') hotspot.highlightOpacity = Number(input.value);
      else if (hotspotField === 'revealSeconds' || hotspotField === 'cutsceneHoldSeconds' || hotspotField === 'cutsceneRepeatCount') hotspot[hotspotField] = Number(input.value);
      else if (hotspotField === 'visibility') hotspot.visibility = input.value as EditorHotspot['visibility'];
      else if (hotspotField === 'cutsceneMedia') hotspot.cutsceneMedia = input.value as EditorHotspot['cutsceneMedia'];
      else if (hotspotField === 'vertexCount') hotspot.shapePoints = circlePoints(Math.max(3, Math.min(24, Math.round(Number(input.value)))));
      else if (hotspotField === 'item' || hotspotField === 'requiresItem') hotspot[hotspotField] = input.value ? input.value as ItemId : undefined;
      else if (hotspotField === 'action') hotspot.action = input.value as EditorHotspot['action'];
      else if (hotspotField === 'event') hotspot.event = input.value as EditorHotspot['event'];
      else if (hotspotField === 'cutscenePath') { hotspot.cutscenePath = input.value; hotspot.cutsceneMedia = detectMediaType(input.value); }
      else if (hotspotField === 'hideoutImage') hotspot.hideoutImage = input.value || undefined;
      else if (hotspotField === 'label' || hotspotField === 'message' || hotspotField === 'highlightColor') hotspot[hotspotField] = input.value;
      this.project.save(); this.render();
    }
  }

  /** Arquivo, modo e volume da trilha presa à sala. */
  private applyRoomAudioField(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): void {
    const room = this.selectedRoom;
    const field = input.dataset.roomAudioField;
    if (!room || !field) return;
    const current = room.audio ?? { path: '', mode: 'every-entry' as RoomAudioMode, volume: 1 };
    if (field === 'path') {
      const path = input.value.trim();
      room.audio = path ? { ...current, path } : undefined;
    } else if (field === 'mode') {
      // As três opções são exclusivas: marcar uma desmarca as outras.
      const mode = (input as HTMLInputElement).value as RoomAudioMode;
      if (!(input as HTMLInputElement).checked) return;
      room.audio = { ...current, mode };
    } else if (field === 'volume') {
      room.audio = { ...current, volume: clamp(Number(input.value), 0, 1) };
    }
    this.project.save();
    this.render();
  }

  private applySceneField(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): void {
    const room = this.selectedRoom;
    if (!room || input.dataset.sceneField !== 'darknessLevel') return;
    room.darknessLevel = clamp(Number(input.value), 0, 1);
    this.project.save();
    this.updateDarknessCanvas();
    const readout = this.root.querySelector<HTMLElement>('[data-role="darkness-readout"]');
    if (readout) readout.textContent = `${Math.round(room.darknessLevel * 100)}%`;
  }

  /**
   * Campos de um foco de luz. Nada aqui recria o painel enquanto o jogador arrasta um
   * controle — só o formato, que muda as dicas mostradas, pede um redesenho.
   */
  private applyLightField(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, committed: boolean): void {
    const field = input.dataset.lightField;
    const lightId = input.dataset.light;
    const light = this.selectedRoom?.lights?.find((entry) => entry.id === lightId);
    if (!field || !light) return;
    let rerender = false;
    if (field === 'radius') light.radius = clamp(Number(input.value), 2, 60);
    else if (field === 'intensity') light.intensity = clamp(Number(input.value), 0, 1);
    else if (field === 'flicker') light.flicker = clamp(Number(input.value), 0, 1);
    else if (field === 'angle') light.angle = ((Math.round(Number(input.value)) % 360) + 360) % 360;
    else if (field === 'aperture') light.aperture = clamp(Math.round(Number(input.value)), 1, 360);
    else if (field === 'color') light.color = input.value;
    else if (field === 'shape' && isLightShape(input.value)) { light.shape = input.value; rerender = true; }
    if (committed) this.project.save();
    this.updateLightReadout(field, light);
    this.updateRotationHint(light);
    this.updateDarknessCanvas();
    // Redesenhar o painel no meio de um arrasto arrancava o slider da mão do mouse e
    // só o clique voltava a funcionar: o formato é um `select`, que só chega commitado.
    if (rerender && committed) this.render();
  }

  /** Mostra ou esconde a dica da rotação sem recriar o bloco do foco. */
  private updateRotationHint(light: EditorLight): void {
    const hint = this.root.querySelector<HTMLElement>(`[data-role="light-rotation-hint"][data-light="${CSS.escape(light.id)}"]`);
    if (hint) hint.hidden = !(light.shape === 'circle' && light.aperture >= 360);
  }

  private updateLightReadout(field: string, light: EditorLight): void {
    const readout = this.root.querySelector<HTMLElement>(`[data-readout="${field}:${CSS.escape(light.id)}"]`);
    if (!readout) return;
    if (field === 'angle') readout.textContent = `${Math.round(light.angle)}°`;
    else if (field === 'aperture') readout.textContent = `${Math.round(light.aperture)}°`;
    else if (field === 'intensity') readout.textContent = `${Math.round(light.intensity * 100)}%`;
    else if (field === 'flicker') readout.textContent = `${Math.round(light.flicker * 100)}%`;
  }

  private handlePointerDown(event: PointerEvent): void {
    if (this.testMode || this.confirm || event.button !== 0) return;
    const target = event.target as HTMLElement;
    const shapePoint = target.closest<HTMLElement>('[data-role="shape-point"]');
    const indicatorPoint = target.closest<HTMLElement>('[data-role="indicator-point"]');
    const hotspotBox = target.closest<HTMLElement>('.editable-hotspot');
    const stage = target.closest<HTMLElement>('[data-role="hotspot-stage"]');
    if (indicatorPoint && hotspotBox && stage && this.selectedRoom) {
      const hotspot = this.selectedRoom.hotspots.find((entry) => entry.id === hotspotBox.dataset.hotspot);
      if (!hotspot) return;
      this.gesture = { type: 'indicator', roomId: this.selectedRoom.id, hotspotId: hotspot.id, startX: event.clientX, startY: event.clientY, origin: { x: hotspot.indicator.x, y: hotspot.indicator.y }, rect: hotspotBox.getBoundingClientRect() };
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (shapePoint && hotspotBox && stage && this.selectedRoom) {
      const hotspot = this.selectedRoom.hotspots.find((entry) => entry.id === hotspotBox.dataset.hotspot);
      const pointIndex = Number(shapePoint.dataset.point);
      const point = hotspot?.shapePoints?.[pointIndex];
      if (!hotspot || !point) return;
      this.gesture = { type: 'shapePoint', roomId: this.selectedRoom.id, hotspotId: hotspot.id, pointIndex, startX: event.clientX, startY: event.clientY, origin: { x: point.x, y: point.y }, rect: hotspotBox.getBoundingClientRect() };
      event.preventDefault();
      event.stopPropagation();
      return;
    }
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
    const connectionMarker = target.closest<HTMLElement>('.scene-connection');
    if (connectionMarker && stage) {
      const connection = this.project.activeLevel.connections.find((entry) => entry.id === connectionMarker.dataset.connection);
      if (!connection) return;
      this.selectedConnectionId = connection.id;
      this.selectedHotspotId = null;
      const markerRect = connectionMarker.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      const originX = ((markerRect.left + markerRect.width / 2 - stageRect.left) / stageRect.width) * 100;
      const originY = ((markerRect.top + markerRect.height / 2 - stageRect.top) / stageRect.height) * 100;
      this.gesture = { type: 'connectionButton', connectionId: connection.id, startX: event.clientX, startY: event.clientY, origin: { x: originX, y: originY }, rect: stageRect };
      return;
    }
    const lightMarker = target.closest<HTMLElement>('[data-role="light-spot"]');
    if (lightMarker && stage && this.selectedRoom) {
      const light = this.selectedRoom.lights?.find((l) => l.id === lightMarker.dataset.light);
      if (!light) return;
      this.selectedLightId = light.id;
      this.selectedHotspotId = null;
      this.selectedConnectionId = null;
      this.gesture = { type: 'lightSpot', roomId: this.selectedRoom.id, lightId: light.id, startX: event.clientX, startY: event.clientY, origin: { x: light.x, y: light.y }, rect: stage.getBoundingClientRect() };
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (stage && (this.selectedHotspotId || this.selectedConnectionId || this.selectedLightId)) {
      this.selectedHotspotId = null;
      this.selectedConnectionId = null;
      this.selectedLightId = null;
      this.render();
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
    } else if (this.gesture.type === 'shapePoint') {
      const gesture = this.gesture;
      const room = this.project.findRoom(gesture.roomId);
      const hotspot = room?.hotspots.find((entry) => entry.id === gesture.hotspotId);
      const point = hotspot?.shapePoints?.[gesture.pointIndex];
      if (!point) return;
      const dx = ((event.clientX - gesture.startX) / gesture.rect.width) * 100;
      const dy = ((event.clientY - gesture.startY) / gesture.rect.height) * 100;
      point.x = clamp(gesture.origin.x + dx, -300, 400);
      point.y = clamp(gesture.origin.y + dy, -300, 400);
      const handle = this.root.querySelector<HTMLElement>(`.editable-hotspot[data-hotspot="${CSS.escape(hotspot!.id)}"] [data-point="${gesture.pointIndex}"]`);
      if (handle) { handle.style.left = `${point.x}%`; handle.style.top = `${point.y}%`; }
      const fill = this.root.querySelector<HTMLElement>(`.editable-hotspot[data-hotspot="${CSS.escape(hotspot!.id)}"] .hotspot-fill`);
      if (fill) fill.style.clipPath = `polygon(${hotspot!.shapePoints!.map((entry) => `${entry.x}% ${entry.y}%`).join(',')})`;
      const outline = this.root.querySelector<SVGPolygonElement>(`.editable-hotspot[data-hotspot="${CSS.escape(hotspot!.id)}"] .hotspot-outline polygon`);
      if (outline) outline.setAttribute('points', hotspot!.shapePoints!.map((entry) => `${entry.x},${entry.y}`).join(' '));
    } else if (this.gesture.type === 'indicator') {
      const gesture = this.gesture;
      const room = this.project.findRoom(gesture.roomId);
      const hotspot = room?.hotspots.find((entry) => entry.id === gesture.hotspotId);
      if (!hotspot) return;
      const dx = ((event.clientX - gesture.startX) / gesture.rect.width) * 100;
      const dy = ((event.clientY - gesture.startY) / gesture.rect.height) * 100;
      hotspot.indicator = { x: clamp(gesture.origin.x + dx, -300, 400), y: clamp(gesture.origin.y + dy, -300, 400) };
      const handle = this.root.querySelector<HTMLElement>(`.editable-hotspot[data-hotspot="${CSS.escape(hotspot.id)}"] [data-role="indicator-point"]`);
      if (handle) { handle.style.left = `${hotspot.indicator.x}%`; handle.style.top = `${hotspot.indicator.y}%`; }
    } else if (this.gesture.type === 'connectionButton') {
      const gesture = this.gesture;
      const connection = this.project.activeLevel.connections.find((entry) => entry.id === gesture.connectionId);
      if (!connection) return;
      const dx = ((event.clientX - gesture.startX) / gesture.rect.width) * 100;
      const dy = ((event.clientY - gesture.startY) / gesture.rect.height) * 100;
      connection.buttonX = clamp(gesture.origin.x + dx, 0, 100);
      connection.buttonY = clamp(gesture.origin.y + dy, 0, 100);
      const marker = this.root.querySelector<HTMLElement>(`.scene-connection[data-connection="${CSS.escape(connection.id)}"]`);
      if (marker) { marker.style.left = `${connection.buttonX}%`; marker.style.top = `${connection.buttonY}%`; }
    } else if (this.gesture.type === 'lightSpot') {
      const gesture = this.gesture;
      const room = this.project.findRoom(gesture.roomId);
      const light = room?.lights?.find((l) => l.id === gesture.lightId);
      if (!light) return;
      const dx = ((event.clientX - gesture.startX) / gesture.rect.width) * 100;
      const dy = ((event.clientY - gesture.startY) / gesture.rect.height) * 100;
      light.x = clamp(gesture.origin.x + dx, 0, 100);
      light.y = clamp(gesture.origin.y + dy, 0, 100);
      const el = this.root.querySelector<HTMLElement>(`[data-role="light-spot"][data-light="${CSS.escape(light.id)}"]`);
      if (el) { el.style.left = `${light.x}%`; el.style.top = `${light.y}%`; }
      this.updateDarknessCanvas();
    } else {
      const gesture = this.gesture;
      if (gesture.type !== 'hotspot') return;
      const room = this.project.findRoom(gesture.roomId);
      const hotspot = room?.hotspots.find((entry) => entry.id === gesture.hotspotId);
      if (!room || !hotspot) return;
      const dx = ((event.clientX - gesture.startX) / gesture.rect.width) * 100;
      const dy = ((event.clientY - gesture.startY) / gesture.rect.height) * 100;
      if (gesture.resize) {
        // Sem teto preso à borda da imagem: um interagível pode ser maior que a cena.
        hotspot.width = clamp(gesture.origin.width + dx, 1, 400);
        hotspot.height = clamp(gesture.origin.height + dy, 1, 400);
      } else {
        hotspot.x = clamp(gesture.origin.x + dx, -100, 100);
        hotspot.y = clamp(gesture.origin.y + dy, -100, 100);
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
    const needsRerender = this.gesture.type === 'hotspot' || this.gesture.type === 'shapePoint' || this.gesture.type === 'indicator' || this.gesture.type === 'connectionButton' || this.gesture.type === 'lightSpot';
    this.gesture = null;
    if (needsRerender) this.render();
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

  private exportJSON(): void {
    this.project.save();
    const blob = new Blob([this.project.toJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `${this.project.data.name.toLowerCase().replace(/\s+/g, '-') || 'mapa'}.json`; link.click();
    // Revogar na mesma volta do laço cancelava o download antes de ele começar em
    // alguns navegadores: o endereço só é liberado depois que o arquivo foi pedido.
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  private async importJSON(file?: File): Promise<void> {
    if (!file) return;
    try {
      this.project.replace(JSON.parse(await file.text()) as unknown);
      this.selectedRoomId = this.project.activeLevel.startRoomId;
      this.selectedItemId = this.project.data.items[0]?.id ?? null;
      this.selectedEntityId = this.project.data.entities[0]?.id ?? null;
      this.resetView(); this.render();
    } catch { window.alert('Não foi possível carregar este JSON. Verifique o formato do arquivo.'); }
  }

  private startTest(): void {
    const level = this.project.activeLevel;
    const start = this.selectedRoomId || level.startRoomId;
    const items = itemsToRuntime(this.project.data.items);
    const entities = entitiesToRuntime(this.project.data.entities);
    // O teste carrega o projeto inteiro: assim um caminho para outro nível funciona aqui também.
    const world = projectToWorld(this.project.data.levels, this.project.data.activeLevelId);
    this.testGame = new Game(undefined, () => 1, world, start, items, entities);
    this.testMode = true;
    this.testInventoryOpen = false;
    this.testAttackNonce = 0;
    this.testJumpscareUntil = 0;
    this.lastTestKey = '';
    // O teste também ouve a trilha do nível 0.
    void this.audio.unlock().then(() => {
      this.audio.setMusic(isLevelZero(level.name, this.testGame?.room.code, this.testGame?.room.image) ? MUSIC_LOBBY : null);
      this.syncTestRoomAudio();
    }).catch(() => undefined);
    this.render();
  }

  /** No teste, a trilha presa à sala toca igual ao jogo. */
  private syncTestRoomAudio(): void {
    const game = this.testGame;
    if (!game) return;
    const audio = (game.room as RoomDefinition).audio;
    if (!audio?.path) { this.audio.stopRoomTrack(); return; }
    const flag = `audio:${game.position}`;
    if (audio.mode === 'once' && game.flags[flag]) { this.audio.stopRoomTrack(); return; }
    void this.audio.playRoomTrack(audio.path, { loop: audio.mode === 'loop', volume: audio.volume })
      .then((started) => { if (started && audio.mode === 'once') game.flags[flag] = true; })
      .catch(() => undefined);
  }

  private async handleTestAction(action: string, data: DOMStringMap): Promise<void> {
    const game = this.testGame;
    if (!game) return;
    void this.audio.unlock().catch(() => undefined);
    switch (action) {
      case 'exit': this.testMode = false; this.testGame = null; this.testInventoryOpen = false; this.audio.stopAll(); this.render(); return;
      case 'move': { const result = game.navigate(data.direction ?? ''); this.audio.play(result.changed ? 'step' : 'locked'); if (result.changed) this.syncTestRoomAudio(); break; }
      case 'hotspot': { const previous = game.position; const result = game.interact(data.hotspot ?? ''); this.audio.play(result.pickup ? 'pickup' : result.changed ? 'use' : 'click'); if (game.position !== previous) this.syncTestRoomAudio(); break; }
      case 'inventory': this.testInventoryOpen = !this.testInventoryOpen; this.audio.play('click'); break;
      case 'use-item': game.useItem(data.item as ItemId); this.audio.play('use'); this.testInventoryOpen = false; break;
      case 'encounter': { const result = game.respondToEncounter(data.choice as EncounterAction); this.audio.play(result.attack ? 'jumpscare' : 'step'); break; }
      case 'restart': this.startTest(); return;
    }
    if (game.attackNonce !== this.testAttackNonce) { this.testAttackNonce = game.attackNonce; this.testJumpscareUntil = performance.now() + 1550; }
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
        this.testJumpscareUntil = now + 1550;
        this.audio.play('jumpscare');
      }
      const key = JSON.stringify({ position: this.testGame.position, status: this.testGame.status, message: this.testGame.message, inventory: this.testGame.inventory, selected: this.testGame.selectedItem, encounter: this.testGame.encounter?.id, cutscene: this.testGame.cutscene?.hotspotId ?? null, attack: this.testAttackNonce, jump: now < this.testJumpscareUntil, panel: this.testInventoryOpen, flags: this.testGame.flags });
      if (key !== this.lastTestKey) { this.lastTestKey = key; this.render(); }
      else this.updateTestReadouts();
    }
    // Prévia do flickering: redesenha a escuridão enquanto o editor da cena está aberto.
    if (!this.testMode && this.hotspotEditorOpen && hasFlicker(this.selectedRoom?.lights)) this.updateDarknessCanvas();
    requestAnimationFrame(this.tick);
  };

  private updateTestReadouts(): void {
    if (!this.testGame) return;
    (['health', 'thirst', 'hunger', 'anxiety'] as const).forEach((key) => {
      const root = this.root.querySelector<HTMLElement>(`[data-test-stat="${key}"]`);
      const value = this.testGame!.stats[key];
      if (root?.querySelector('b')) root.querySelector('b')!.textContent = String(Math.round(value));
      const bar = root?.querySelector<HTMLElement>('em'); if (bar) bar.style.width = `${value}%`;
    });
    const timer = this.root.querySelector<HTMLElement>('.test-timer i');
    if (timer && this.testGame.encounter) timer.style.width = `${(this.testGame.encounter.remaining / this.testGame.encounter.timeLimit) * 100}%`;
    if (this.testGame.cutscene) {
      const cutscene = this.testGame.cutscene;
      const progress = cutscene.mediaType === 'image'
        ? (cutscene.holdSeconds > 0 ? cutscene.elapsed / cutscene.holdSeconds : 1)
        : (cutscene.repeatCount > 0 ? cutscene.loopsCompleted / cutscene.repeatCount : 1);
      const bar = this.root.querySelector<HTMLElement>('.test-cutscene-progress i');
      if (bar) bar.style.width = `${Math.min(100, Math.max(0, progress * 100))}%`;
    }
  }
}
