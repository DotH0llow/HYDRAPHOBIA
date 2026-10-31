import type { Game } from '../core/Game';
import type { ItemDefinition, NpcDefinition, RoomDefinition, RoomNpc } from '../config/world';
import type { ItemId, NpcId } from '../types';
import { NPC_DUMMY_ART } from '../systems/npc';
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
    // A etiqueta sai para o lado em que sobra cena, e some junto com o ponteiro.
    const side = entry.x >= 50 ? 'left' : 'right';
    return `<div class="npc-figure${talking ? ' talking' : ''}" data-npc-figure="${esc(entry.npcId)}" style="left:${entry.x}%;top:${entry.y}%;--npc-height:${entry.height}%;--npc-flip:${entry.flip ? -1 : 1}">
      <button class="npc-hit" data-action="npc" data-test-action="npc" data-npc="${esc(entry.npcId)}" aria-label="Falar com ${esc(definition.name)}">${art}</button>
      <span class="npc-label" data-side="${side}" aria-hidden="true">
        <b>${esc(definition.name)}</b>
        <svg class="npc-leader" viewBox="0 0 42 22" preserveAspectRatio="none"><line x1="0" y1="0" x2="42" y2="22" vector-effect="non-scaling-stroke" /></svg>
        <i class="npc-dot"></i>
      </span>
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
const npcAnchor = (game: Game, npcId: NpcId): { entry: RoomNpc | undefined; x: number; y: number; side: 'above' | 'left' | 'right' } => {
  const entry = (game.room as RoomDefinition).npcs?.find((item) => item.npcId === npcId);
  if (!entry) return { entry, x: 50, y: 40, side: 'above' };
  const head = entry.y - entry.height;
  // Com a cabeça perto da borda de cima não há tela para o balão: ele vai para o lado
  // em que sobra cena, na altura do rosto, e a ponta aponta de lado em vez de de baixo.
  if (head < 26) {
    // O balão só vai para a direita se couber inteiro lá; senão vai para a esquerda.
    const toRight = entry.x < 46;
    const x = toRight ? Math.max(4, Math.min(50, entry.x + 4)) : Math.max(50, Math.min(96, entry.x - 4));
    return { entry, x, y: Math.max(8, head + entry.height * 0.14), side: toRight ? 'right' : 'left' };
  }
  return { entry, x: Math.max(16, Math.min(84, entry.x)), y: head, side: 'above' };
};

/**
 * A ponta do balão. Ela é desenhada, e não uma caixa girada: o traço afina até o bico,
 * como numa HQ. A tira de creme no topo cobre a borda do balão na largura da ponta —
 * é ela que faz as duas peças parecerem uma só, sem emenda.
 */
const BALLOON_TAIL = `<svg class="balloon-tail" viewBox="0 0 36 36" aria-hidden="true" focusable="false">
  <path d="M7 0 C 10 13, 16 25, 32 34 C 20 23, 19 11, 21 0" />
  <rect class="tail-join" x="0" y="0" width="36" height="3.4" />
</svg>`;

/**
 * O balão de fala. Ele cresce com o texto — a largura tem um teto e a altura não tem
 * nenhum — e a ponta sai dele apontando para quem está falando. As respostas ficam
 * numa barra própria, embaixo: dentro do balão elas o transformariam num menu.
 *
 * No balão só existe a fala. O nome é a etiqueta da cena, que aparece ao passar o
 * mouse na pessoa; e a troca abre por uma resposta escrita no editor, nunca por um
 * botão da barra — um botão ali diria que dá para trocar com quem não quer trocar.
 */
export const dialogueMarkup = (game: Game, items: ItemLibrary): string => {
  const dialogue = game.dialogue;
  if (!dialogue) return '';
  const definition = game.npcDefinition(dialogue.npcId);
  const line = game.dialogueLine;
  if (!definition || !line) return '';
  if (dialogue.trading) return tradeMarkup(game, items, definition);
  const { x, y, side } = npcAnchor(game, dialogue.npcId);
  return `<div class="dialogue-layer">
    <article class="speech-balloon" data-side="${side}" style="left:${x}%;top:${y}%">
      <p data-role="balloon-text">${esc(line.text)}</p>
      ${BALLOON_TAIL}
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
        <button data-action="history" data-test-action="history">Histórico <em>H</em></button>
        <button class="dialogue-leave" data-action="dialogue-end" data-test-action="dialogue-end">Ir</button>
      </div>
    </div>
  </div>`;
};

/**
 * "Itens de O homem do carrinho" não é português. Quando o nome começa com artigo, a
 * preposição se junta a ele — e quase todo nome de NPC deste jogo começa com artigo.
 */
const ownerLabel = (name: string): string => {
  const parts = /^(O|A|Os|As)\s+(.+)$/.exec(name.trim());
  if (!parts) return `Itens de ${name}`;
  const joined = ({ O: 'do', A: 'da', Os: 'dos', As: 'das' } as Record<string, string>)[parts[1]!]!;
  return `Itens ${joined} ${parts[2]}`;
};

/** A seta grossa que separa o que sai do que entra, na mesa de trocas. */
const DEAL_ARROW = `<svg class="deal-arrow" viewBox="0 0 48 32" aria-hidden="true"><path d="M2 13 h28 l-6 -10 l20 15 l-20 15 l6 -10 h-28 z" /></svg>`;

/**
 * A mesa de trocas. Não há dinheiro: os dois lados são medidos na mesma escala de
 * valor, e o que o jogador oferece precisa alcançar o que ele pede. O número não
 * aparece — aparece a vontade do vendedor, que é o mesmo cálculo dito de outro jeito.
 *
 * O desenho é o de uma mesa improvisada: as cartas são recortes de papel colados num
 * quadro escuro, e a arte de cada item é invertida para imprimir no papel como um
 * desenho a traço, em vez de ficar uma foto preta colada ali.
 */
export const tradeMarkup = (game: Game, items: ItemLibrary, definition: NpcDefinition): string => {
  const dialogue = game.dialogue!;
  const memory = game.npcMemory(dialogue.npcId);
  const totals = game.tradeTotals;
  const tense = game.stats.anxiety >= 60;
  const pick = dialogue.pick;

  const card = (side: 'ask' | 'offer', id: ItemId, available: number, index: number): string => {
    const item = items[id];
    if (!item) return '';
    const price = side === 'ask' ? game.askPriceOf(id) : game.offerPriceOf(id);
    const onTable = (side === 'ask' ? dialogue.ask : dialogue.offer).find((entry) => entry.id === id)?.quantity ?? 0;
    const chosen = pick?.side === side && pick.id === id;
    return `<button class="trade-card${chosen ? ' chosen' : ''}${onTable > 0 ? ' on-table' : ''}" style="--tilt:${(index % 3) - 1}"
      data-action="trade-pick" data-test-action="trade-pick" data-side="${side}" data-item="${esc(id)}"
      aria-pressed="${chosen}" title="${esc(item.name)} · ${side === 'ask' ? 'ele cobra' : 'ele paga'} ${price}">
      <span class="card-art">${item.image ? `<img src="${esc(item.image)}" alt="" />` : `<em>${esc(item.icon)}</em>`}</span>
      <b>${esc(item.name)}</b>
      <i class="card-price">${price}</i>
      <em class="card-count">${available}</em>
    </button>`;
  };

  const tableCard = (side: 'ask' | 'offer', entry: { id: ItemId; quantity: number }): string => {
    const item = items[entry.id];
    if (!item) return '';
    return `<button class="deal-card" data-action="trade-adjust" data-test-action="trade-adjust" data-side="${side}" data-item="${esc(entry.id)}" data-amount="-1" title="Tirar ${esc(item.name)} da mesa">
      <span class="card-art">${item.image ? `<img src="${esc(item.image)}" alt="" />` : `<em>${esc(item.icon)}</em>`}</span>
      <em class="card-count">${entry.quantity}</em>
    </button>`;
  };

  const mine = game.inventory;
  const theirs = memory.stock;
  const interest = Math.round(game.tradeInterest * 100);
  const enough = totals.offer >= totals.ask;
  const chose = dialogue.ask.length > 0 || dialogue.offer.length > 0;
  const onTable = pick ? ((pick.side === 'ask' ? dialogue.ask : dialogue.offer).find((entry) => entry.id === pick.id)?.quantity ?? 0) : 0;
  const available = pick
    ? (pick.side === 'ask' ? theirs : mine).find((entry) => entry.id === pick.id)?.quantity ?? 0
    : 0;

  return `<div class="trade-layer" role="dialog" aria-label="Troca com ${esc(definition.name)}">
    <section class="trade-board">
      <h2 class="trade-title">Troca improvisada</h2>
      <button class="trade-close" data-action="trade-close" data-test-action="trade-close" aria-label="Fechar a troca">&times;</button>
      <div class="trade-grid">
        <section class="trade-col">
          <h3>Meus itens</h3>
          <div class="trade-cards">${mine.length > 0 ? mine.map((entry, index) => card('offer', entry.id, entry.quantity, index)).join('') : '<p class="trade-empty">Você não tem nada para dar.</p>'}</div>
        </section>
        <section class="trade-deal">
          <h3>Troca</h3>
          <div class="trade-table">
            <div class="deal-side">${dialogue.offer.map((entry) => tableCard('offer', entry)).join('') || '<i class="deal-slot"></i>'}</div>
            ${DEAL_ARROW}
            <div class="deal-side">${dialogue.ask.map((entry) => tableCard('ask', entry)).join('') || '<i class="deal-slot"></i>'}</div>
          </div>
          <div class="trade-interest">
            <span>Interesse na troca</span>
            <i><u style="width:${interest}%" data-role="trade-interest"></u></i>
          </div>
          <p class="trade-feeling">${esc(game.tradeFeeling)}</p>
          ${tense ? '<p class="trade-warning">Ele vê o estado em que você chegou. Cada item custa 1 a mais.</p>' : ''}
        </section>
        <section class="trade-col">
          <h3>${esc(ownerLabel(definition.name))}</h3>
          <div class="trade-cards">${theirs.length > 0 ? theirs.map((entry, index) => card('ask', entry.id, entry.quantity, index)).join('') : '<p class="trade-empty">Os bolsos dele estão vazios.</p>'}</div>
        </section>
      </div>
      <footer class="trade-actions">
        <button data-action="trade-offer" data-test-action="trade-offer"${pick && onTable < available ? '' : ' disabled'}>Oferecer</button>
        <button data-action="trade-withdraw" data-test-action="trade-withdraw"${pick && onTable > 0 ? '' : ' disabled'}>Retirar</button>
        <button class="people-cta" data-action="trade-confirm" data-test-action="trade-confirm"${enough && chose ? '' : ' disabled'}>Confirmar troca</button>
        <button data-action="trade-close" data-test-action="trade-close">Fechar</button>
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
