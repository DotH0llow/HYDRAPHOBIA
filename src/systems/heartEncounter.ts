/**
 * "Segure o medo" — o coração e a caixa torácica.
 *
 * O coração não é mais algo que se agarra: ele *é* o ponteiro do jogador. Para onde o
 * mouse vai, ele vai atrás — e é essa a única coisa que o jogador controla. O trabalho
 * é levá-lo até a caixa torácica, no meio da cena, e mantê-lo lá dentro.
 *
 * Levar custa. Quanto mais perto do tórax, mais o coração empurra para fora: é uma
 * resistência que cresce ao se aproximar, e é ela que dá peso à coisa na mão. Por cima
 * disso, de poucos em poucos segundos, um tranco mais forte joga o coração para uma
 * direção qualquer — nunca para dentro do tórax, sempre para longe dele. Nenhum dos
 * dois tira o coração do jogador; os dois só fazem o caminho de volta ser sempre outro.
 *
 * Tudo aqui é cálculo puro, sem DOM e sem relógio próprio: a tela entrega o tempo
 * passado e onde o ponteiro está, e recebe de volta o novo estado. É isso que deixa a
 * mecânica viver separada da cena e da entidade — ela não sabe o que está desenhado
 * atrás dela, e por isso serve a qualquer encontro.
 *
 * As medidas são em % da cena, as mesmas que o editor usa para posicionar qualquer
 * coisa: assim a mecânica não depende do tamanho da janela de quem está jogando.
 */

/**
 * A caixa torácica, parada no meio da cena. É uma elipse, não o desenho inteiro.
 *
 * As medidas são em % da cena nos dois eixos, e a cena tem a proporção da janela de
 * quem está jogando — então a caixa não pode bater com o desenho em toda janela.
 * Estas proporções acertam numa janela 16:10, a do meio; nas outras a arte entra
 * contida na elipse, e sobra elipse sem desenho. A sobra é sempre para esse lado de
 * propósito: o jogo nunca cobra mais do que mostra.
 */
export const CAGE = { x: 50, y: 47, rx: 8, ry: 15.5 } as const;

/** Até onde o coração pode ir antes de bater na borda da cena. */
const BOUNDS = { minX: 4, maxX: 96, minY: 6, maxY: 94 } as const;

/**
 * O coração nasce num canto da cena, e chegar até ele leva um instante. Sem este
 * perdão o encontro já começava perdendo, e quem demorasse a entender o que estava
 * vendo morria antes de tocar em nada.
 */
const GRACE_SECONDS = 1.6;

/**
 * A mola do ponteiro. Ela é de propósito frouxa: se fosse rígida, o coração seria o
 * cursor e nada mais, e não haveria o que sentir. Frouxa, ele chega sempre atrasado,
 * e o atraso é maior justamente onde a resistência é maior — na boca do tórax.
 */
const FOLLOW_STIFFNESS = 16;

/** Quanto tempo a tela treme mais forte depois de um tranco. */
export const JOLT_SECONDS = 0.42;

/** Até onde, em raios da caixa, a resistência ainda é sentida. */
const RESIST_REACH = 2.4;

/**
 * Quanto da calma já conquistada escorre a cada segundo fora do tórax. É pouco de
 * propósito: perder o coração não devolve o jogador ao começo, só o faz recuar — e o
 * que cobra o tempo dele é a barra vermelha, que não para mais.
 */
const HOLD_DECAY = 0.18;

export interface HeartConfig {
  /** Segundos dentro da caixa que encerram o encontro. */
  holdSeconds: number;
  /** Segundos fora da caixa que deixam o medo escapar de vez. */
  escapeSeconds: number;
  /** Com que força o coração resiste a ser levado ao tórax, em % da cena por segundo². */
  pull: number;
  /** De quantos em quantos segundos, em média, vem o tranco forte. */
  joltEvery: number;
}

export const DEFAULT_HEART_CONFIG: HeartConfig = { holdSeconds: 9, escapeSeconds: 13.4, pull: 54, joltEvery: 2.4 };

export interface HeartState {
  /** Posição e velocidade do coração, em % da cena. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Para onde ele está escorregando agora, em radianos, e quanto falta para mudar de ideia. */
  angle: number;
  turnIn: number;
  /** Quanto o jogador já segurou dentro da caixa, e quanto o medo já escapou. */
  held: number;
  escaped: number;
  /**
   * Quanto tempo o encontro inteiro já dura, dentro ou fora da caixa. Nem `held` nem
   * `escaped` servem para isso: os dois andam para trás. É este relógio que a tela usa
   * para subir a batida — ela cresce com o encontro, não com o acerto do jogador.
   */
  elapsed: number;
  /** Segundos de perdão no começo: o coração nasce fora, e alcançá-lo leva um tempo. */
  grace: number;
  /** Quanto falta para o próximo tranco, e quanto resta do tremor forte do último. */
  joltIn: number;
  jolt: number;
}

/** O que a tela precisa saber a cada quadro. */
export type HeartOutcome = 'running' | 'held' | 'escaped';

/** Onde o ponteiro do jogador está, em % da cena; `null` é ele ter saído da tela. */
export interface HeartPointer { x: number; y: number }

/** O intervalo até o próximo tranco: poucos segundos, nunca os mesmos. */
const nextJolt = (config: HeartConfig, random: () => number): number =>
  Math.max(0.5, config.joltEvery) * (0.55 + random() * 0.9);

/**
 * O coração entra por uma borda da cena, nunca a mesma: ele já nasce fora da caixa, e
 * o primeiro trabalho do jogador é atravessar a cena atrás dele. Eram dois cantos
 * fixos, e quem jogasse duas vezes já sabia para onde olhar.
 */
export const createHeart = (random: () => number = Math.random): HeartState => {
  const along = 12 + random() * 76;
  const side = Math.floor(random() * 4);
  const rim = side === 0 ? { x: along, y: 8 }
    : side === 1 ? { x: 92, y: along }
    : side === 2 ? { x: along, y: 92 }
    : { x: 8, y: along };
  return {
    ...rim,
    vx: 0,
    vy: 0,
    angle: Math.atan2(rim.y - CAGE.y, rim.x - CAGE.x),
    turnIn: 0.4,
    held: 0,
    escaped: 0,
    elapsed: 0,
    grace: GRACE_SECONDS,
    joltIn: nextJolt(DEFAULT_HEART_CONFIG, random),
    jolt: 0,
  };
};

export const heartInsideCage = (x: number, y: number): boolean => cageDistance(x, y) <= 1;

/** A distância até o centro da caixa, medida em raios dela: 1 é a borda das costelas. */
const cageDistance = (x: number, y: number): number => {
  const dx = (x - CAGE.x) / CAGE.rx;
  const dy = (y - CAGE.y) / CAGE.ry;
  return Math.hypot(dx, dy);
};

/**
 * O quanto o coração resiste onde ele está, de 0 a 1. É 1 dentro das costelas e some
 * de vez ao longe: a resistência é a ser *levado ao tórax*, não a ser movido.
 */
export const heartResistance = (x: number, y: number): number => {
  const distance = cageDistance(x, y);
  if (distance <= 1) return 1;
  return Math.max(0, (RESIST_REACH - distance) / (RESIST_REACH - 1));
};

/** O quanto o medo já escapou, de 0 a 1 — é o que a barra da tela mostra. */
export const heartExposure = (state: HeartState, config: HeartConfig): number =>
  Math.min(1, state.escaped / Math.max(0.1, config.escapeSeconds));

/**
 * O quanto o encontro já se arrastou, de 0 a 1, contado desde o primeiro quadro. É o
 * que faz a batida de coração entrar muda e ir enchendo a sala: o aperto cresce com a
 * demora, e quem resolve rápido quase não a ouve.
 */
export const heartIntensity = (state: HeartState, config: HeartConfig): number =>
  Math.min(1, state.elapsed / Math.max(0.1, config.holdSeconds));

/** O quanto do encontro já passou, de 0 a 1. */
export const heartProgress = (state: HeartState, config: HeartConfig): number =>
  Math.min(1, state.held / Math.max(0.1, config.holdSeconds));

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/** O ângulo que aponta do centro da caixa para onde o coração está. */
const awayFromCage = (state: HeartState, random: () => number): number => {
  const dx = state.x - CAGE.x;
  const dy = state.y - CAGE.y;
  // Exatamente no centro não há "para fora": qualquer direção serve, e é o que se usa.
  if (Math.hypot(dx, dy) < 0.001) return random() * Math.PI * 2;
  return Math.atan2(dy, dx);
};

/**
 * O maior passo que a integração aceita de uma vez. A mola e o arrasto são fortes, e
 * num passo grande o arrasto come quase toda a velocidade antes de ela virar
 * distância: o coração ia parecer preso na lama sempre que um quadro atrasasse. Com um
 * teto, um quadro longo vira vários passos curtos, e a mecânica responde igual numa
 * máquina de 144 Hz e numa que engasgou.
 */
const MAX_STEP = 1 / 60;

/**
 * Um quadro da mecânica, partido em quantos passos curtos forem precisos.
 *
 * O coração persegue o ponteiro sempre — essa é a única coisa que o jogador comanda.
 * Contra a mola do ponteiro trabalham três coisas: a resistência, que empurra para
 * fora do tórax e cresce perto dele; um escorregão lento, que muda de direção sozinho
 * e impede o coração de ficar parado; e o tranco, que de poucos em poucos segundos o
 * arremessa para longe da caixa. A soma das três decide o atraso com que ele chega à
 * mão, e é esse atraso que o jogador sente como peso.
 */
export const stepHeart = (
  state: HeartState,
  config: HeartConfig,
  delta: number,
  pointer: HeartPointer | null,
  random: () => number = Math.random,
): { state: HeartState; outcome: HeartOutcome; jolted: boolean } => {
  const total = clamp(delta, 0, 0.25);
  const parts = Math.max(1, Math.ceil(total / MAX_STEP));
  let current = state;
  let outcome: HeartOutcome = 'running';
  let jolted = false;
  for (let i = 0; i < parts; i += 1) {
    const result = advanceHeart(current, config, total / parts, pointer, random);
    current = result.state;
    outcome = result.outcome;
    jolted = jolted || result.jolted;
    // Acabou no meio do quadro: o resto dele não existe mais.
    if (outcome !== 'running') break;
  }
  return { state: current, outcome, jolted };
};

/** Um passo curto da mecânica; `stepHeart` é quem decide quantos deles cabem no quadro. */
const advanceHeart = (
  state: HeartState,
  config: HeartConfig,
  delta: number,
  pointer: HeartPointer | null,
  random: () => number,
): { state: HeartState; outcome: HeartOutcome; jolted: boolean } => {
  const step = delta;
  const next: HeartState = { ...state };

  // O escorregão muda de direção sozinho; a nova direção tende a apontar para fora.
  next.turnIn -= step;
  if (next.turnIn <= 0) {
    next.angle = awayFromCage(next, random) + (random() * 2 - 1) * Math.PI * 0.75;
    next.turnIn = 0.35 + random() * 0.75;
  }

  // Quanto mais perto do fim, mais o medo insiste: tudo que empurra ganha metade de força.
  const urgency = 1 + 0.5 * Math.min(1, next.held / Math.max(0.1, config.holdSeconds));
  const force = config.pull * urgency;

  // O escorregão de sempre, fraco, só para o coração nunca descansar.
  next.vx += Math.cos(next.angle) * force * 0.35 * step;
  next.vy += Math.sin(next.angle) * force * 0.35 * step;

  // A resistência: sai do centro da caixa para fora, e só existe perto dela.
  const resistance = heartResistance(next.x, next.y);
  if (resistance > 0) {
    const out = awayFromCage(next, random);
    next.vx += Math.cos(out) * force * resistance * step;
    next.vy += Math.sin(out) * force * resistance * step;
  }

  // O tranco. A direção é sorteada dentro de meia volta em torno do "para fora", de
  // modo que nenhum sorteio possa apontar para dentro do tórax: o tranco sempre tira
  // o coração de onde ele precisa estar, nunca o entrega de presente.
  next.joltIn -= step;
  next.jolt = Math.max(0, next.jolt - step);
  let jolted = false;
  if (next.joltIn <= 0) {
    const angle = awayFromCage(next, random) + (random() * 2 - 1) * Math.PI * 0.45;
    // O tranco leva o coração para longe de verdade: com o arrasto da mão, este
    // impulso vale perto de um quarto da cena. Menos do que isso e ele voltava para o
    // tórax antes de o jogador perceber que tinha sido arremessado.
    const kick = force * (3.4 + random() * 1.9);
    next.vx += Math.cos(angle) * kick;
    next.vy += Math.sin(angle) * kick;
    next.angle = angle;
    next.turnIn = 0.35 + random() * 0.75;
    next.joltIn = nextJolt(config, random);
    next.jolt = JOLT_SECONDS;
    jolted = true;
  }

  if (pointer) {
    next.vx += (pointer.x - next.x) * FOLLOW_STIFFNESS * step;
    next.vy += (pointer.y - next.y) * FOLLOW_STIFFNESS * step;
  }

  const drag = pointer ? 9 : 2.6;
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

  next.elapsed += step;
  next.grace = Math.max(0, next.grace - step);
  // A barra vermelha não para nunca: passado o perdão inicial, o medo escapa também
  // com o coração guardado no tórax. Ela é o prazo do encontro, e segurar o coração
  // não compra tempo — só enche a outra barra antes de este prazo acabar.
  if (next.grace === 0) next.escaped += step;
  if (heartInsideCage(next.x, next.y)) next.held += step;
  // Fora do tórax a calma escorre devagar, e nunca abaixo de zero.
  else next.held = Math.max(0, next.held - step * HOLD_DECAY);

  const outcome: HeartOutcome = next.escaped >= config.escapeSeconds
    ? 'escaped'
    : next.held >= config.holdSeconds ? 'held' : 'running';
  return { state: next, outcome, jolted };
};
