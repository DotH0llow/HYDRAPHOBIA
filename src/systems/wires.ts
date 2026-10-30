import type { ChallengeDefinition } from '../config/world';
import type { WireChallengeState } from '../types';

/**
 * O painel de fios.
 *
 * Seis saídas à esquerda, com letras, e seis conectores à direita, com números. De
 * três a seis saídas têm fio; as outras ficam mortas. A ligação certa já está no
 * painel quando ele abre e não aparece em lugar nenhum: o jogador descobre tentando,
 * e cada tentativa errada custa um choque. É por isso que a cor dos fios é sorteada a
 * cada painel — ela não é pista nenhuma, é só o que torna um painel diferente do outro.
 */

export const OUTPUT_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export const CONNECTOR_LABELS = ['1', '2', '3', '4', '5', '6'] as const;

/** As cores possíveis de um fio; cada painel sorteia as suas, sem repetir. */
export const WIRE_COLORS = ['#d94f3d', '#e3b23c', '#4f9dd9', '#5fb562', '#b36fd1', '#dcdcd2', '#8a5a33', '#39c0b8'] as const;

export const MIN_WIRES = 3;
export const MAX_WIRES = 6;

/** Dano de cada ligação errada, quando o nível não escolheu outro. */
export const DEFAULT_SHOCK_DAMAGE = 3;

/**
 * Embaralha sem confiar no sorteio. O modo de teste do editor usa um sorteio preso em
 * 1, e `Math.floor(1 * (index + 1))` cai uma casa fora do vetor: o embaralhamento
 * trocava a posição por `undefined` e o painel inteiro deixava de ser desenhável.
 */
const shuffled = <T>(values: readonly T[], random: () => number): T[] => {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.min(index, Math.max(0, Math.floor(random() * (index + 1))));
    [copy[index], copy[other]] = [copy[other]!, copy[index]!];
  }
  return copy;
};

const clampCount = (value: number): number => Math.max(MIN_WIRES, Math.min(MAX_WIRES, Math.round(value)));

/**
 * Monta um painel. Quando o nível escreveu as ligações, são elas que valem — e só as
 * que apontam para uma letra e um número que existem. Sem isso, o painel é sorteado.
 */
export const createWirePanel = (challenge: ChallengeDefinition | undefined, random: () => number): WireChallengeState => {
  const written = (challenge?.wirePairs ?? []).filter((pair) =>
    (OUTPUT_LABELS as readonly string[]).includes(pair.from) && (CONNECTOR_LABELS as readonly string[]).includes(pair.to));
  // Uma letra só pode sair para um lugar, e dois fios não chegam ao mesmo conector.
  const pairs: Array<{ from: string; to: string }> = [];
  written.forEach((pair) => {
    if (pairs.some((entry) => entry.from === pair.from || entry.to === pair.to)) return;
    pairs.push({ from: pair.from, to: pair.to });
  });

  if (pairs.length < MIN_WIRES) {
    const count = clampCount(challenge?.wireCount ?? MIN_WIRES + Math.floor(random() * (MAX_WIRES - MIN_WIRES + 1)));
    const freeOutputs = shuffled(OUTPUT_LABELS.filter((label) => !pairs.some((pair) => pair.from === label)), random);
    const freeConnectors = shuffled(CONNECTOR_LABELS.filter((label) => !pairs.some((pair) => pair.to === label)), random);
    while (pairs.length < count && freeOutputs.length > 0 && freeConnectors.length > 0) {
      pairs.push({ from: freeOutputs.pop()!, to: freeConnectors.pop()! });
    }
  }

  const colors = shuffled(WIRE_COLORS, random);
  const solution: Record<string, string> = {};
  // Os fios aparecem na ordem das letras, para o painel não mudar de cara a cada quadro.
  const wires = pairs
    .sort((a, b) => a.from.localeCompare(b.from))
    .map((pair, index) => {
      solution[pair.from] = pair.to;
      return { from: pair.from, color: colors[index % colors.length]! };
    });

  return {
    wires,
    connectors: shuffled(CONNECTOR_LABELS, random),
    solution,
    linked: {},
    holding: null,
    shockAt: 0,
    mistakes: 0,
  };
};

export const wiresRemaining = (state: WireChallengeState): number =>
  state.wires.filter((wire) => !state.linked[wire.from]).length;

export const wiresSolved = (state: WireChallengeState): boolean => wiresRemaining(state) === 0;

/** Um conector já usado não aceita um segundo fio. */
export const connectorTaken = (state: WireChallengeState, connector: string): boolean =>
  Object.values(state.linked).includes(connector);

/**
 * Liga o fio que está na mão a um conector. Acertar prende o fio ali para sempre;
 * errar devolve a mão vazia e cobra o choque — quem decide o dano é o jogo.
 */
export const connectWire = (state: WireChallengeState, connector: string): 'none' | 'linked' | 'shock' => {
  const from = state.holding;
  if (!from || state.linked[from] || connectorTaken(state, connector)) return 'none';
  state.holding = null;
  if (state.solution[from] === connector) {
    state.linked[from] = connector;
    return 'linked';
  }
  state.mistakes += 1;
  state.shockAt = Date.now();
  return 'shock';
};
