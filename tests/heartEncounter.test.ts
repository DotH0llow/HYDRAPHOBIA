import { describe, expect, it } from 'vitest';
import {
  CAGE, createHeart, DEFAULT_HEART_CONFIG, GRIP_RADIUS, heartExposure, heartInsideCage, heartProgress,
  heartWithinGrip, stepHeart, type HeartConfig, type HeartState,
} from '../src/systems/heartEncounter';

/** Um sorteio previsível: a mecânica recebe o acaso de fora justamente para isto. */
const fixedRandom = (value = 0.5) => () => value;

/** Já passado o perdão inicial: quase todo teste aqui olha o encontro em andamento. */
const heartAt = (x: number, y: number): HeartState => ({ ...createHeart(fixedRandom()), x, y, vx: 0, vy: 0, grace: 0 });

/** Roda a mecânica por `seconds`, em quadros de 60 Hz, segurando onde o teste mandar. */
const run = (
  state: HeartState,
  config: HeartConfig,
  seconds: number,
  grabAt: (state: HeartState) => { x: number; y: number } | null,
  random = fixedRandom(),
): { state: HeartState; outcome: string } => {
  let current = state;
  let outcome = 'running';
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames && outcome === 'running'; i += 1) {
    const result = stepHeart(current, config, 1 / 60, grabAt(current), random);
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
    // Um segundo inteiro solto e fora da caixa, logo no começo, ainda não perde.
    const inicio = run(createHeart(fixedRandom(0.1)), config, 1, () => null);
    expect(inicio.outcome).toBe('running');
    expect(inicio.state.escaped).toBe(0);
    // Passado o perdão, o mesmo descuido custa o encontro.
    const depois = run(inicio.state, config, 4, () => null);
    expect(depois.outcome).toBe('escaped');
  });
});

describe('segurar o coração', () => {
  it('a mão só fecha perto dele', () => {
    const heart = heartAt(50, 50);
    expect(heartWithinGrip(heart, 50, 50)).toBe(true);
    expect(heartWithinGrip(heart, 50 + GRIP_RADIUS - 1, 50)).toBe(true);
    expect(heartWithinGrip(heart, 50 + GRIP_RADIUS + 3, 50)).toBe(false);
  });

  it('segurar no centro da caixa mantém o coração lá e encerra o encontro', () => {
    const config: HeartConfig = { ...DEFAULT_HEART_CONFIG, holdSeconds: 2, escapeSeconds: 3 };
    const { outcome } = run(heartAt(CAGE.x, CAGE.y), config, 6, () => ({ x: CAGE.x, y: CAGE.y }));
    expect(outcome).toBe('held');
  });

  it('soltar deixa o medo escapar e o encontro falha', () => {
    const config: HeartConfig = { ...DEFAULT_HEART_CONFIG, holdSeconds: 20, escapeSeconds: 1.5 };
    const { outcome } = run(heartAt(CAGE.x, CAGE.y), config, 12, () => null);
    expect(outcome).toBe('escaped');
  });

  it('a mão escorrega quando o coração é levado longe demais dela', () => {
    // O ponteiro fica parado num canto; o coração começa no outro lado da cena.
    const far = stepHeart(heartAt(90, 90), DEFAULT_HEART_CONFIG, 1 / 60, { x: 10, y: 10 }, fixedRandom());
    expect(far.released).toBe(true);
    const near = stepHeart(heartAt(50, 50), DEFAULT_HEART_CONFIG, 1 / 60, { x: 50, y: 50 }, fixedRandom());
    expect(near.released).toBe(false);
  });
});

describe('as barras do encontro', () => {
  it('voltar para dentro recupera parte do que escapou', () => {
    const config: HeartConfig = { ...DEFAULT_HEART_CONFIG, holdSeconds: 30, escapeSeconds: 10 };
    const solto = run(heartAt(CAGE.x, CAGE.y), config, 1.5, () => null);
    expect(solto.state.escaped).toBeGreaterThan(0);
    const recuperado = run(solto.state, config, 1.5, () => ({ x: CAGE.x, y: CAGE.y }));
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
    const config: HeartConfig = { ...DEFAULT_HEART_CONFIG, holdSeconds: 99, escapeSeconds: 99, pull: 160 };
    let random = 0;
    const { state } = run(heartAt(50, 50), config, 20, () => null, () => { random = (random + 0.37) % 1; return random; });
    expect(state.x).toBeGreaterThanOrEqual(0);
    expect(state.x).toBeLessThanOrEqual(100);
    expect(state.y).toBeGreaterThanOrEqual(0);
    expect(state.y).toBeLessThanOrEqual(100);
  });
});
