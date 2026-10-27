/**
 * "Segure o medo" — o coração e a caixa torácica.
 *
 * O encontro não é mais uma pergunta de duas respostas: a caixa torácica do
 * personagem aparece no meio da cena e o coração dele tenta escapar dela. O jogador
 * segura o coração com o ponteiro e precisa mantê-lo dentro das costelas enquanto a
 * entidade estiver ali. Soltar não é o fim — o coração deriva, e dá para alcançá-lo de
 * novo —, mas cada instante do lado de fora aproxima o medo de escapar de vez.
 *
 * Tudo aqui é cálculo puro, sem DOM e sem relógio próprio: a tela entrega o tempo
 * passado e onde o ponteiro está, e recebe de volta o novo estado. É isso que deixa a
 * mecânica viver separada da cena e da entidade — ela não sabe o que está desenhado
 * atrás dela, e por isso serve a qualquer encontro.
 *
 * As medidas são em % da cena, as mesmas que o editor usa para posicionar qualquer
 * coisa: assim a mecânica não depende do tamanho da janela de quem está jogando.
 */

/** A caixa torácica, parada no meio da cena. É uma elipse, não o desenho inteiro. */
export const CAGE = { x: 50, y: 47, rx: 9.2, ry: 16 } as const;

/** Até onde o coração pode ir antes de bater na borda da cena. */
const BOUNDS = { minX: 4, maxX: 96, minY: 6, maxY: 94 } as const;

/**
 * O quanto o ponteiro precisa estar perto do coração para agarrá-lo, e a que distância
 * a mão escorrega. Sem a mão escorregando a mecânica era só manter o cursor no meio da
 * caixa: a mola sempre vencia a fuga, e não havia nada a perder. Com ela, um arranco
 * forte o bastante solta o coração, e o jogador tem de ir atrás dele outra vez.
 */
export const GRIP_RADIUS = 9;
const GRIP_BREAK = 15;

/**
 * O coração nasce num canto da cena, e chegar até ele leva um instante. Sem este
 * perdão o encontro já começava perdendo, e quem demorasse a entender o que estava
 * vendo morria antes de tocar em nada.
 */
const GRACE_SECONDS = 1.6;

export interface HeartConfig {
  /** Segundos dentro da caixa que encerram o encontro. */
  holdSeconds: number;
  /** Segundos fora da caixa que deixam o medo escapar de vez. */
  escapeSeconds: number;
  /** Com que força o coração foge, em % da cena por segundo². */
  pull: number;
}

export const DEFAULT_HEART_CONFIG: HeartConfig = { holdSeconds: 9, escapeSeconds: 3.4, pull: 54 };

/** O ponteiro está perto o bastante para fechar a mão no coração? */
export const heartWithinGrip = (state: HeartState, x: number, y: number): boolean =>
  Math.hypot(state.x - x, state.y - y) <= GRIP_RADIUS;

export interface HeartState {
  /** Posição e velocidade do coração, em % da cena. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Para onde ele está fugindo agora, em radianos, e quanto falta para mudar de ideia. */
  angle: number;
  turnIn: number;
  /** Quanto o jogador já segurou dentro da caixa, e quanto o medo já escapou. */
  held: number;
  escaped: number;
  /** Segundos de perdão no começo: o coração nasce fora, e alcançá-lo leva um tempo. */
  grace: number;
}

/** O que a tela precisa saber a cada quadro. */
export type HeartOutcome = 'running' | 'held' | 'escaped';

/** Ponto do ponteiro enquanto o jogador segura o coração; `null` é ter soltado. */
export interface HeartGrab { x: number; y: number }

/**
 * O coração entra pelo canto, como no susto: ele já está fora da caixa, e o primeiro
 * trabalho do jogador é trazê-lo para dentro.
 */
export const createHeart = (random: () => number = Math.random): HeartState => ({
  x: random() < 0.5 ? 92 : 8,
  y: 12,
  vx: 0,
  vy: 0,
  angle: Math.PI * 0.5,
  turnIn: 0.4,
  held: 0,
  escaped: 0,
  grace: GRACE_SECONDS,
});

export const heartInsideCage = (x: number, y: number): boolean => {
  const dx = (x - CAGE.x) / CAGE.rx;
  const dy = (y - CAGE.y) / CAGE.ry;
  return dx * dx + dy * dy <= 1;
};

/** O quanto o medo já escapou, de 0 a 1 — é o que a barra da tela mostra. */
export const heartExposure = (state: HeartState, config: HeartConfig): number =>
  Math.min(1, state.escaped / Math.max(0.1, config.escapeSeconds));

/** O quanto do encontro já passou, de 0 a 1. */
export const heartProgress = (state: HeartState, config: HeartConfig): number =>
  Math.min(1, state.held / Math.max(0.1, config.holdSeconds));

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/**
 * Um quadro da mecânica.
 *
 * O coração tem sempre uma direção de fuga, que troca sozinha de tempos em tempos e é
 * puxada para longe do centro da caixa — é o que faz com que ele nunca queira ficar
 * parado onde deveria. Enquanto o jogador segura, uma mola muito mais forte o traz para
 * o ponteiro; ela vence a fuga, mas não instantaneamente, e é essa briga que dá o peso
 * da coisa na mão. Soltar tira a mola e deixa só o arrasto, então o coração escorrega.
 */
export const stepHeart = (
  state: HeartState,
  config: HeartConfig,
  delta: number,
  grab: HeartGrab | null,
  random: () => number = Math.random,
): { state: HeartState; outcome: HeartOutcome; released: boolean } => {
  const step = clamp(delta, 0, 0.1);
  const next: HeartState = { ...state };

  // A fuga muda de direção sozinha; a nova direção tende a apontar para fora da caixa,
  // e a virada vem com um arranco — é o arranco que arrisca soltar a mão do jogador.
  next.turnIn -= step;
  let lurched = false;
  if (next.turnIn <= 0) {
    const away = Math.atan2(next.y - CAGE.y, next.x - CAGE.x);
    const spread = (random() * 2 - 1) * Math.PI * 0.75;
    next.angle = away + spread;
    next.turnIn = 0.35 + random() * 0.75;
    lurched = true;
  }

  // Quanto mais perto do fim, mais o medo insiste: a fuga ganha metade de força.
  const urgency = 1 + 0.5 * Math.min(1, next.held / Math.max(0.1, config.holdSeconds));
  const pull = config.pull * urgency;
  next.vx += Math.cos(next.angle) * pull * step;
  next.vy += Math.sin(next.angle) * pull * step;
  if (lurched) {
    const kick = pull * (0.3 + random() * 0.26);
    next.vx += Math.cos(next.angle) * kick;
    next.vy += Math.sin(next.angle) * kick;
  }

  if (grab) {
    // A mola do ponteiro: forte o bastante para vencer a fuga, frouxa o bastante para
    // o coração chegar atrasado à mão — sem esse atraso não havia nada para segurar.
    const stiffness = 24;
    next.vx += (grab.x - next.x) * stiffness * step;
    next.vy += (grab.y - next.y) * stiffness * step;
  }

  const drag = grab ? 9 : 2.6;
  const damping = Math.max(0, 1 - drag * step);
  next.vx *= damping;
  next.vy *= damping;

  next.x += next.vx * step;
  next.y += next.vy * step;

  // Na borda da cena o coração para em vez de sumir: o jogador sempre pode alcançá-lo.
  if (next.x < BOUNDS.minX || next.x > BOUNDS.maxX) next.vx *= -0.35;
  if (next.y < BOUNDS.minY || next.y > BOUNDS.maxY) next.vy *= -0.35;
  next.x = clamp(next.x, BOUNDS.minX, BOUNDS.maxX);
  next.y = clamp(next.y, BOUNDS.minY, BOUNDS.maxY);

  next.grace = Math.max(0, next.grace - step);
  if (heartInsideCage(next.x, next.y)) {
    next.held += step;
    // Voltar para dentro recupera o fôlego, mas mais devagar do que se perde.
    next.escaped = Math.max(0, next.escaped - step * 0.6);
  } else if (next.grace === 0) {
    next.escaped += step;
  }

  // Um arranco que leve o coração longe demais escorrega entre os dedos.
  const released = Boolean(grab) && Math.hypot(next.x - grab!.x, next.y - grab!.y) > GRIP_BREAK;

  const outcome: HeartOutcome = next.escaped >= config.escapeSeconds
    ? 'escaped'
    : next.held >= config.holdSeconds ? 'held' : 'running';
  return { state: next, outcome, released };
};
