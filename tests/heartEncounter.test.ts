import { describe, expect, it } from 'vitest';
import {
  CAGE, createHeart, DEFAULT_HEART_CONFIG, heartExposure, heartInsideCage, heartIntensity, heartProgress,
  heartResistance, JOLT_SECONDS, stepHeart, type HeartConfig, type HeartState,
} from '../src/systems/heartEncounter';

/** Um sorteio previsível: a mecânica recebe o acaso de fora justamente para isto. */
const fixedRandom = (value = 0.5) => () => value;

/** Já passado o perdão inicial: quase todo teste aqui olha o encontro em andamento. */
const heartAt = (x: number, y: number): HeartState => ({ ...createHeart(fixedRandom()), x, y, vx: 0, vy: 0, grace: 0 });

/** O coração parado longe do próximo tranco: isola o que o teste quer olhar. */
const calm = (x: number, y: number): HeartState => ({ ...heartAt(x, y), joltIn: 99 });

/** Roda a mecânica por `seconds`, em quadros de 60 Hz, mirando onde o teste mandar. */
const run = (
  state: HeartState,
  config: HeartConfig,
  seconds: number,
  aimAt: (state: HeartState) => { x: number; y: number } | null,
  random = fixedRandom(),
): { state: HeartState; outcome: string } => {
  let current = state;
  let outcome = 'running';
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames && outcome === 'running'; i += 1) {
    const result = stepHeart(current, config, 1 / 60, aimAt(current), random);
    current = result.state;
    outcome = result.outcome;
  }
  return { state: current, outcome };
};

describe('a caixa torácica', () => {
  it('o centro da caixa está dentro e as bordas da cena estão fora', () => {
    expect(heartInsideCage(CAGE.x, CAGE.y)).toBe(true);
    expect(heartInsideCage(CAGE.x, CAGE.y - CAGE.ry + 0.5)).toBe(true);
    expect(heartInsideCage(CAGE.x + CAGE.rx + 2, CAGE.y)).toBe(false);
    expect(heartInsideCage(5, 90)).toBe(false);
  });

  it('o coração começa fora dela, para o jogador ter de buscá-lo', () => {
    const heart = createHeart(fixedRandom(0.1));
    expect(heartInsideCage(heart.x, heart.y)).toBe(false);
  });

  it('os primeiros instantes são de graça: alcançar o coração leva um tempo', () => {
    const config: HeartConfig = { ...DEFAULT_HEART_CONFIG, holdSeconds: 30, escapeSeconds: 1 };
    // Um segundo inteiro à deriva e fora da caixa, logo no começo, ainda não perde.
    const inicio = run(createHeart(fixedRandom(0.1)), config, 1, () => null);
    expect(inicio.outcome).toBe('running');
    expect(inicio.state.escaped).toBe(0);
    // Passado o perdão, o mesmo descuido custa o encontro.
    const depois = run(inicio.state, config, 4, () => null);
    expect(depois.outcome).toBe('escaped');
  });
});

describe('o aperto do encontro', () => {
  it('conta o tempo corrido, dentro ou fora da caixa', () => {
    const config: HeartConfig = { ...DEFAULT_HEART_CONFIG, holdSeconds: 99, escapeSeconds: 99 };
    // Fora da caixa e sem ponteiro: `held` não anda, e o relógio do encontro anda assim mesmo.
    const solto = run(calm(90, 90), config, 2, () => null);
    expect(solto.state.held).toBe(0);
    expect(solto.state.elapsed).toBeCloseTo(2, 1);
  });

  it('a batida entra muda e chega ao máximo quando o encontro se arrasta', () => {
    const config: HeartConfig = { ...DEFAULT_HEART_CONFIG, holdSeconds: 4, escapeSeconds: 99 };
    expect(heartIntensity(createHeart(fixedRandom()), config)).toBe(0);
    const meio = run(calm(90, 90), config, 2, () => null);
    expect(heartIntensity(meio.state, config)).toBeCloseTo(0.5, 1);
    const fim = run(calm(90, 90), config, 9, () => null);
    expect(heartIntensity(fim.state, config)).toBe(1);
  });
});

describe('o coração como ponteiro', () => {
  it('ele vai atrás do ponteiro onde quer que o ponteiro esteja', () => {
    // Nada de agarrar: o ponteiro está no outro canto da cena e o coração vem assim mesmo.
    const longe = run(calm(90, 90), DEFAULT_HEART_CONFIG, 1.2, () => ({ x: 20, y: 20 }));
    expect(longe.state.x).toBeLessThan(90);
    expect(longe.state.y).toBeLessThan(90);
  });

  it('mirar no centro da caixa leva o coração até lá e encerra o encontro', () => {
    const config: HeartConfig = { ...DEFAULT_HEART_CONFIG, holdSeconds: 2, escapeSeconds: 6 };
    const { outcome } = run(createHeart(fixedRandom(0.1)), config, 25, () => ({ x: CAGE.x, y: CAGE.y }));
    expect(outcome).toBe('held');
  });

  it('largar o ponteiro deixa o medo escapar e o encontro falha', () => {
    const config: HeartConfig = { ...DEFAULT_HEART_CONFIG, holdSeconds: 20, escapeSeconds: 1.5 };
    const { outcome } = run(heartAt(CAGE.x, CAGE.y), config, 12, () => null);
    expect(outcome).toBe('escaped');
  });
});

describe('a resistência ao tórax', () => {
  it('é inteira dentro das costelas e some ao longe', () => {
    expect(heartResistance(CAGE.x, CAGE.y)).toBe(1);
    expect(heartResistance(CAGE.x + CAGE.rx * 0.5, CAGE.y)).toBe(1);
    const perto = heartResistance(CAGE.x + CAGE.rx * 1.5, CAGE.y);
    expect(perto).toBeGreaterThan(0);
    expect(perto).toBeLessThan(1);
    expect(heartResistance(CAGE.x + CAGE.rx * 3, CAGE.y)).toBe(0);
  });

  it('o coração chega atrasado à mão, e o atraso é maior na boca do tórax', () => {
    const aim = { x: CAGE.x, y: CAGE.y };
    const dentro = run(calm(CAGE.x, CAGE.y), DEFAULT_HEART_CONFIG, 2, () => aim);
    // Mirando no mesmo ponto, mas longe da caixa, onde a resistência não existe.
    const fora = { x: 85, y: 85 };
    const longe = run({ ...calm(85, 85), angle: 0, turnIn: 99 }, DEFAULT_HEART_CONFIG, 2, () => fora);
    const atrasoDentro = Math.hypot(dentro.state.x - aim.x, dentro.state.y - aim.y);
    const atrasoLonge = Math.hypot(longe.state.x - fora.x, longe.state.y - fora.y);
    expect(atrasoDentro).toBeGreaterThan(atrasoLonge);
  });
});

describe('o tranco', () => {
  it('vem de tempos em tempos e avisa a tela', () => {
    const config: HeartConfig = { ...DEFAULT_HEART_CONFIG, holdSeconds: 99, escapeSeconds: 99 };
    const pronto: HeartState = { ...heartAt(CAGE.x + 5, CAGE.y), joltIn: 0.001 };
    const batida = stepHeart(pronto, config, 1 / 60, null, fixedRandom());
    expect(batida.jolted).toBe(true);
    expect(batida.state.jolt).toBe(JOLT_SECONDS);
    // E o próximo já está marcado, nunca no mesmo instante do anterior.
    expect(batida.state.joltIn).toBeGreaterThan(0);
  });

  it('nunca joga o coração na direção do tórax', () => {
    const config: HeartConfig = { ...DEFAULT_HEART_CONFIG, holdSeconds: 99, escapeSeconds: 99 };
    let semente = 0;
    const random = () => { semente = (semente + 0.137) % 1; return semente; };
    for (let i = 0; i < 60; i += 1) {
      // O coração parado fora da caixa; o tranco é a única coisa que o move neste quadro.
      const antes: HeartState = { ...heartAt(CAGE.x + CAGE.rx * 2, CAGE.y + 4), joltIn: 0.001, angle: 0, turnIn: 99 };
      const { state } = stepHeart(antes, config, 1 / 60, null, random);
      const distanciaAntes = Math.hypot(antes.x - CAGE.x, antes.y - CAGE.y);
      const empurrao = Math.hypot(antes.x + state.vx - CAGE.x, antes.y + state.vy - CAGE.y);
      expect(empurrao).toBeGreaterThan(distanciaAntes);
    }
  });

  it('o intervalo entre trancos varia', () => {
    const config: HeartConfig = { ...DEFAULT_HEART_CONFIG, holdSeconds: 99, escapeSeconds: 99 };
    let semente = 0;
    const random = () => { semente = (semente + 0.211) % 1; return semente; };
    const intervalos = new Set<number>();
    for (let i = 0; i < 12; i += 1) {
      const { state } = stepHeart({ ...heartAt(60, 60), joltIn: 0.001 }, config, 1 / 60, null, random);
      intervalos.add(+state.joltIn.toFixed(3));
    }
    expect(intervalos.size).toBeGreaterThan(1);
  });
});

describe('as barras do encontro', () => {
  it('voltar para dentro recupera parte do que escapou', () => {
    // Sem trancos: o que este teste olha é a recuperação, e um tranco no meio do
    // caminho joga o coração para longe de novo e esconde o que se queria medir.
    const config: HeartConfig = { ...DEFAULT_HEART_CONFIG, holdSeconds: 30, escapeSeconds: 20, joltEvery: 20 };
    const solto = run(calm(CAGE.x, CAGE.y), config, 1.5, () => null);
    expect(solto.state.escaped).toBeGreaterThan(0);
    const recuperado = run({ ...solto.state, joltIn: 99 }, config, 8, () => ({ x: CAGE.x, y: CAGE.y }));
    expect(recuperado.state.escaped).toBeLessThan(solto.state.escaped);
  });

  it('as duas medidas ficam entre 0 e 1', () => {
    const config: HeartConfig = { ...DEFAULT_HEART_CONFIG, holdSeconds: 4, escapeSeconds: 2 };
    const heart: HeartState = { ...heartAt(50, 50), held: 99, escaped: 99 };
    expect(heartProgress(heart, config)).toBe(1);
    expect(heartExposure(heart, config)).toBe(1);
    const zerado: HeartState = { ...heartAt(50, 50), held: 0, escaped: 0 };
    expect(heartProgress(zerado, config)).toBe(0);
    expect(heartExposure(zerado, config)).toBe(0);
  });

  it('o coração nunca sai da cena', () => {
    const config: HeartConfig = { ...DEFAULT_HEART_CONFIG, holdSeconds: 99, escapeSeconds: 99, pull: 160, joltEvery: 0.6 };
    let random = 0;
    const { state } = run(heartAt(50, 50), config, 20, () => null, () => { random = (random + 0.37) % 1; return random; });
    expect(state.x).toBeGreaterThanOrEqual(0);
    expect(state.x).toBeLessThanOrEqual(100);
    expect(state.y).toBeGreaterThanOrEqual(0);
    expect(state.y).toBeLessThanOrEqual(100);
  });
});
