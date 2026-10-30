import type { Game } from '../core/Game';
import type { ItemDefinition, NpcDefinition, RoomDefinition, RoomNpc } from '../config/world';
import type { ItemId, NpcId } from '../types';
import { moodLabel, NPC_DUMMY_ART } from '../systems/npc';
import { connectorTaken, OUTPUT_LABELS } from '../systems/wires';

/**
 * As camadas de gente e de desafio, desenhadas uma vez só.
 *
 * O jogo e o modo de teste do editor mostram as mesmas coisas aqui de propósito: o
 * balão, a troca e o painel de fios são o lugar onde um nível se prova, e testá-los
 * no editor só vale alguma coisa se o que aparece lá for o que o jogador vai ver.
 * Os `data-action` são os mesmos nos dois; quem trata cada um é que muda.
 */

export type ItemLibrary = Record<ItemId, ItemDefinition>;

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);

const clock = (seconds: number): string =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/**
 * As pessoas da cena. Cada uma está plantada em um ponto da sala, com a altura que
 * quem montou o nível escolheu; sem arte escolhida, o que aparece é o boneco de teste
 * em SVG, de propósito — ele serve para a cena já poder ser jogada antes de a arte
 * existir, e não se confunde com nada que vá ficar.
 */
export const npcSceneMarkup = (game: Game): string => {
  const room = game.room as RoomDefinition;
  return (room.npcs ?? []).map((entry) => {
    if (entry.requiresFlag && !game.flags[entry.requiresFlag]) return '';
    const definition = game.npcDefinition(entry.npcId);
    if (!definition) return '';
    const talking = game.dialogue?.npcId === entry.npcId;
    const art = definition.art ? `<img src="${esc(definition.art)}" alt="${esc(definition.name)}" />` : NPC_DUMMY_ART;
    return `<div class="npc-figure${talking ? ' talking' : ''}" data-npc-figure="${esc(entry.npcId)}" style="left:${entry.x}%;top:${entry.y}%;--npc-height:${entry.height}%;--npc-flip:${entry.flip ? -1 : 1}">
      <button class="npc-hit" data-action="npc" data-test-action="npc" data-npc="${esc(entry.npcId)}" aria-label="Falar com ${esc(definition.name)}">${art}</button>
      <span class="npc-tag">${esc(definition.name)}</span>
    </div>`;
  }).join('');
};

/**
 * Onde o balão desta pessoa fica na cena, e para que lado a ponta dele aponta.
 *
 * O ponto de apoio é a cabeça, não os pés: a pessoa é desenhada de baixo para cima a
 * partir do Y dela, então o balão por cima sai da altura `y - altura`. Quem é alto
 * demais para caber com o balão em cima recebe o balão por baixo, saindo dos ombros.
 */
const npcAnchor = (game: Game, npcId: NpcId): { entry: RoomNpc | undefined; y: number; below: boolean } => {
  const entry = (game.room as RoomDefinition).npcs?.find((item) => item.npcId === npcId);
  if (!entry) return { entry, y: 40, below: false };
  const head = entry.y - entry.height;
  const below = head < 26;
  return { entry, y: below ? Math.min(92, head + entry.height * 0.3) : head, below };
};

/**
 * O balão de fala. Ele cresce com o texto — a largura tem um teto e a altura não tem
 * nenhum — e a ponta sai dele apontando para quem está falando. As respostas ficam
 * numa barra própria, embaixo: dentro do balão elas o transformariam num menu.
 */
export const dialogueMarkup = (game: Game, items: ItemLibrary): string => {
  const dialogue = game.dialogue;
  if (!dialogue) return '';
  const definition = game.npcDefinition(dialogue.npcId);
  const line = game.dialogueLine;
  if (!definition || !line) return '';
  if (dialogue.trading) return tradeMarkup(game, items, definition);
  const { entry, y, below } = npcAnchor(game, dialogue.npcId);
  const x = Math.max(16, Math.min(84, entry?.x ?? 50));
  return `<div class="dialogue-layer">
    <article class="speech-balloon" data-side="${below ? 'below' : 'above'}" style="left:${x}%;top:${y}%">
      <header><b>${esc(definition.name)}</b>${definition.title ? `<small>${esc(definition.title)}</small>` : ''}</header>
      <p data-role="balloon-text">${esc(line.text)}</p>
      <i class="balloon-tail" aria-hidden="true"></i>
    </article>
    <div class="dialogue-bar">
      <div class="dialogue-answers">
        ${game.dialogueAnswers.map((answer) => {
          const missing = answer.requiresItem && !game.inventory.some((item) => item.id === answer.requiresItem && item.quantity > 0);
          const need = answer.requiresItem ? items[answer.requiresItem]?.name ?? answer.requiresItem : '';
          return `<button class="dialogue-answer${missing ? ' unavailable' : ''}" data-action="dialogue-answer" data-test-action="dialogue-answer" data-answer="${esc(answer.id)}"${missing ? ' disabled' : ''}>
            <span>${esc(answer.text)}</span>
            ${answer.requiresItem ? `<small>${missing ? 'exige' : 'usa'} ${esc(need)}</small>` : ''}
            ${answer.opensTrade ? '<small>abre a troca</small>' : ''}
          </button>`;
        }).join('')}
      </div>
      <div class="dialogue-tools">
        ${definition.trades ? '<button data-action="dialogue-trade" data-test-action="dialogue-trade">Trocar</button>' : ''}
        <button data-action="history" data-test-action="history">Histórico <em>H</em></button>
        <button class="dialogue-leave" data-action="dialogue-end" data-test-action="dialogue-end">Encerrar</button>
      </div>
    </div>
  </div>`;
};

/**
 * A tela de trocas. Não há dinheiro: os dois lados da mesa são medidos na mesma escala
 * de valor, e a troca fecha quando o que o jogador põe alcança o que ele pede. O
 * vendedor cobra pelo humor que tem — e um pouco mais de quem chega mal.
 */
export const tradeMarkup = (game: Game, items: ItemLibrary, definition: NpcDefinition): string => {
  const dialogue = game.dialogue!;
  const memory = game.npcMemory(dialogue.npcId);
  const totals = game.tradeTotals;
  const tense = game.stats.anxiety >= 60;
  const row = (side: 'ask' | 'offer', id: ItemId, available: number): string => {
    const item = items[id];
    if (!item) return '';
    const price = side === 'ask' ? game.askPriceOf(id) : game.offerPriceOf(id);
    const chosen = (side === 'ask' ? dialogue.ask : dialogue.offer).find((entry) => entry.id === id)?.quantity ?? 0;
    return `<li class="trade-row${chosen > 0 ? ' chosen' : ''}">
      <span class="trade-art">${item.image ? `<img src="${esc(item.image)}" alt="" />` : esc(item.icon)}</span>
      <span class="trade-name"><b>${esc(item.name)}</b><small>${available} em estoque</small></span>
      <span class="trade-price">${price}</span>
      <span class="trade-count"><button data-action="trade-adjust" data-test-action="trade-adjust" data-side="${side}" data-item="${esc(id)}" data-amount="-1" aria-label="Menos um">&minus;</button><em>${chosen}</em><button data-action="trade-adjust" data-test-action="trade-adjust" data-side="${side}" data-item="${esc(id)}" data-amount="1" aria-label="Mais um">+</button></span>
    </li>`;
  };
  const enough = totals.offer >= totals.ask;
  const chose = dialogue.ask.length > 0 || dialogue.offer.length > 0;
  return `<div class="trade-layer" role="dialog" aria-label="Troca com ${esc(definition.name)}">
    <section class="trade-panel">
      <header>
        <div><small>TROCA</small><h2>${esc(definition.name)}</h2></div>
        <div class="trade-mood"><small>DISPOSIÇÃO</small><b>${esc(moodLabel(memory.reputation))}</b><i><u style="width:${memory.reputation}%"></u></i></div>
        <button class="trade-close" data-action="trade-close" data-test-action="trade-close" aria-label="Fechar a troca">&times;</button>
      </header>
      ${tense ? '<p class="trade-warning">Ele vê o estado em que você chegou. Cada item custa 1 a mais.</p>' : ''}
      <div class="trade-columns">
        <div class="trade-side">
          <h3>O que ele tem</h3>
          <ul>${memory.stock.length > 0 ? memory.stock.map((entry) => row('ask', entry.id, entry.quantity)).join('') : '<li class="trade-empty">Os bolsos dele estão vazios.</li>'}</ul>
        </div>
        <div class="trade-side">
          <h3>O que você tem</h3>
          <ul>${game.inventory.length > 0 ? game.inventory.map((entry) => row('offer', entry.id, entry.quantity)).join('') : '<li class="trade-empty">Você não tem nada para dar.</li>'}</ul>
        </div>
      </div>
      <footer>
        <div class="trade-scale"><span>Você pede <b>${totals.ask}</b></span><span>Você oferece <b class="${enough ? 'ok' : 'short'}">${totals.offer}</b></span></div>
        <button class="primary people-cta" data-action="trade-confirm" data-test-action="trade-confirm"${enough && chose ? '' : ' disabled'}>Fechar a troca</button>
        <button data-action="trade-close" data-test-action="trade-close">Voltar à conversa</button>
      </footer>
    </section>
  </div>`;
};

/** O histórico: tudo o que foi dito nesta campanha, na ordem em que foi dito. */
export const historyMarkup = (game: Game): string => {
  const log = game.dialogueLog;
  return `<div class="history-layer" role="dialog" aria-modal="true" aria-label="Histórico das conversas">
    <section class="history-panel">
      <header><div><small>REGISTRO FALADO</small><h2>Conversas</h2></div><button data-action="history" data-test-action="history" aria-label="Fechar">&times;</button></header>
      <div class="history-log">
        ${log.length === 0 ? '<p class="history-empty">Você ainda não falou com ninguém.</p>' : log.map((entry) => `
          <article class="history-line ${entry.side}">
            <small>${esc(entry.speaker)} · ${clock(entry.at)}</small>
            <p>${esc(entry.text)}</p>
          </article>`).join('')}
      </div>
      <button class="primary people-cta" data-action="history" data-test-action="history">Fechar</button>
    </section>
  </div>`;
};

/**
 * O desafio. Primeiro a cutscene que o abre, se houver uma; depois o painel. Na saída
 * fica a consequência que o nível escreveu — um texto, um som, uma imagem.
 */
export const challengeMarkup = (game: Game): string => {
  const challenge = game.challenge;
  if (!challenge) return '';
  const intro = challenge.intro;
  if (intro) {
    const media = intro.mediaType === 'video'
      ? `<video src="${esc(intro.mediaPath)}" autoplay muted playsinline data-role="challenge-video"></video>`
      : `<img src="${esc(intro.mediaPath)}" alt="" />`;
    return `<div class="cutscene-layer challenge-intro" role="dialog" aria-label="Abertura do desafio"><div class="cutscene-media">${media}</div></div>`;
  }
  return wirePanelMarkup(game);
};

/**
 * O painel de fios. Seis saídas com letras à esquerda, seis conectores com números à
 * direita, e de três a seis fios entre eles. A ligação certa já está no painel e não
 * aparece em canto nenhum: descobri-la é o jogo, e cada erro custa um choque.
 */
export const wirePanelMarkup = (game: Game): string => {
  const wires = game.challenge!.wires;
  const rowY = (index: number): number => ((index + 0.5) / 6) * 100;
  const curves = Object.entries(wires.linked).map(([from, to]) => {
    const wire = wires.wires.find((entry) => entry.from === from);
    const y1 = rowY(OUTPUT_LABELS.indexOf(from as typeof OUTPUT_LABELS[number]));
    const y2 = rowY(wires.connectors.indexOf(to));
    return `<path d="M6 ${y1} C 38 ${y1}, 62 ${y2}, 94 ${y2}" stroke="${esc(wire?.color ?? '#dcdcd2')}" />`;
  }).join('');
  const left = OUTPUT_LABELS.map((label, index) => {
    const wire = wires.wires.find((entry) => entry.from === label);
    if (!wire) return `<li class="wire-port dead" style="--row:${index}"><b>${label}</b><i aria-hidden="true"></i><small>sem fio</small></li>`;
    const linked = Boolean(wires.linked[label]);
    return `<li class="wire-port${linked ? ' linked' : ''}${wires.holding === label ? ' held' : ''}" style="--row:${index};--wire:${esc(wire.color)}">
      <b>${label}</b>
      <button data-action="wire-hold" data-test-action="wire-hold" data-wire="${label}"${linked ? ' disabled' : ''} aria-label="Fio da saída ${label}"><i aria-hidden="true"></i></button>
    </li>`;
  }).join('');
  const right = wires.connectors.map((label, index) => {
    const taken = connectorTaken(wires, label);
    return `<li class="wire-socket${taken ? ' taken' : ''}" style="--row:${index}">
      <button data-action="wire-link" data-test-action="wire-link" data-connector="${label}"${taken || !wires.holding ? ' disabled' : ''} aria-label="Conector ${label}"><i aria-hidden="true"></i></button>
      <b>${label}</b>
    </li>`;
  }).join('');
  const remaining = wires.wires.length - Object.keys(wires.linked).length;
  return `<div class="challenge-layer" data-role="wire-panel" data-shock="false" role="dialog" aria-label="Conectar os fios">
    <section class="wire-board">
      <header><small>PAINEL DE MANUTENÇÃO</small><h2>Conectar os fios</h2><p>Cada fio tem um destino certo. Errar fecha o circuito em você.</p></header>
      <div class="wire-field">
        <ul class="wire-column left">${left}</ul>
        <svg class="wire-canvas" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${curves}</svg>
        <ul class="wire-column right">${right}</ul>
      </div>
      <footer>
        <span class="wire-count">${remaining === 0 ? 'Painel fechado.' : `${remaining} fio${remaining === 1 ? '' : 's'} na mão`}</span>
        <span class="wire-mistakes">${wires.mistakes} choque${wires.mistakes === 1 ? '' : 's'}</span>
        <button class="wire-quit" data-action="challenge-give-up" data-test-action="challenge-give-up">Largar o painel</button>
      </footer>
    </section>
    <div class="wire-shock" aria-hidden="true"></div>
  </div>`;
};
