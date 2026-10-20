import type { RoomLight } from '../config/world';

export type LightShape = 'circle' | 'square' | 'rectangle' | 'star' | 'pentagon' | 'triangle';

export const LIGHT_SHAPES: ReadonlyArray<{ id: LightShape; label: string }> = [
  { id: 'circle', label: 'Círculo' },
  { id: 'square', label: 'Quadrado' },
  { id: 'rectangle', label: 'Retângulo' },
  { id: 'star', label: 'Estrela' },
  { id: 'pentagon', label: 'Pentágono' },
  { id: 'triangle', label: 'Triângulo' },
];

const SHAPE_IDS = new Set<string>(LIGHT_SHAPES.map((shape) => shape.id));

export const isLightShape = (value: unknown): value is LightShape => typeof value === 'string' && SHAPE_IDS.has(value);

/** Abertura padrão: o foco inteiro. */
export const FULL_APERTURE = 360;

/** Abertura normalizada em graus: quanto do foco fica visível (1 a 360). */
export const apertureOf = (light: RoomLight): number => {
  const value = light.aperture;
  if (typeof value !== 'number' || !Number.isFinite(value)) return FULL_APERTURE;
  return Math.max(1, Math.min(FULL_APERTURE, value));
};

/** Vértices de cada formato em coordenadas unitárias, antes da rotação e da escala. */
const polygonPoints = (shape: LightShape): Array<{ x: number; y: number }> => {
  switch (shape) {
    case 'square': return [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }];
    case 'rectangle': return [{ x: -1, y: -0.5 }, { x: 1, y: -0.5 }, { x: 1, y: 0.5 }, { x: -1, y: 0.5 }];
    case 'triangle': return regular(3);
    case 'pentagon': return regular(5);
    case 'star': return star(5, 0.45);
    case 'circle': return [];
  }
};

const regular = (sides: number): Array<{ x: number; y: number }> =>
  Array.from({ length: sides }, (_, index) => {
    const angle = -Math.PI / 2 + (index / sides) * Math.PI * 2;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  });

const star = (points: number, innerRatio: number): Array<{ x: number; y: number }> =>
  Array.from({ length: points * 2 }, (_, index) => {
    const angle = -Math.PI / 2 + (index / (points * 2)) * Math.PI * 2;
    const radius = index % 2 === 0 ? 1 : innerRatio;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });

/**
 * Até onde o degradê precisa chegar para que o formato inteiro acenda. Um quadrado,
 * por exemplo, tem os cantos a √2 do centro: com o degradê terminando no raio, só o
 * círculo inscrito aparecia e todo formato parecia um círculo.
 */
export const shapeReach = (shape: LightShape): number => {
  const points = polygonPoints(shape);
  if (points.length === 0) return 1;
  return points.reduce((reach, point) => Math.max(reach, Math.hypot(point.x, point.y)), 0);
};

/** Fase própria de cada foco, para que lâmpadas vizinhas não pisquem em uníssono. */
const phaseOf = (light: RoomLight): number => ((light.x * 12.9898 + light.y * 78.233) % 6.2831);

/**
 * Multiplicador de brilho do piscar, entre `1 - flicker` e `1`. Duas senoides de
 * frequências diferentes dão um tremor elétrico em vez de uma pulsação regular.
 */
export const flickerFactor = (light: RoomLight, timeMs: number): number => {
  const amount = Math.max(0, Math.min(1, light.flicker ?? 0));
  if (amount <= 0) return 1;
  const seconds = timeMs / 1000;
  const phase = phaseOf(light);
  const wave = 0.62 * Math.sin(seconds * 11.3 + phase) + 0.38 * Math.sin(seconds * 27.7 + phase * 2.3);
  return 1 - amount * (0.5 + 0.5 * Math.max(-1, Math.min(1, wave)));
};

export const hasFlicker = (lights: readonly RoomLight[] | undefined): boolean =>
  (lights ?? []).some((light) => (light.flicker ?? 0) > 0);

const traceShape = (ctx: CanvasRenderingContext2D, light: RoomLight, cx: number, cy: number, radius: number): void => {
  const shape: LightShape = isLightShape(light.shape) ? light.shape : 'circle';
  ctx.beginPath();
  if (shape === 'circle') {
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    return;
  }
  const radians = ((light.angle ?? 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  polygonPoints(shape).forEach((point, index) => {
    const x = cx + (point.x * cos - point.y * sin) * radius;
    const y = cy + (point.x * sin + point.y * cos) * radius;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
};

/**
 * Fatia visível do foco. Com abertura menor que 360° o foco vira uma cunha —
 * 180° dá exatamente um meio-foco — centrada na rotação escolhida.
 */
const traceAperture = (ctx: CanvasRenderingContext2D, light: RoomLight, cx: number, cy: number, radius: number): void => {
  const aperture = (apertureOf(light) * Math.PI) / 180;
  const center = (((light.angle ?? 0) - 90) * Math.PI) / 180;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, radius, center - aperture / 2, center + aperture / 2);
  ctx.closePath();
};

/**
 * Pinta a escuridão da sala e abre os focos de luz nela. O mesmo desenho serve ao
 * jogo e à prévia do editor, para que o que se vê no editor seja o que o jogador vê.
 */
export const drawRoomLighting = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  darkness: number,
  lights: readonly RoomLight[] = [],
  timeMs = 0,
): void => {
  ctx.clearRect(0, 0, width, height);
  if (darkness <= 0 && lights.length === 0) return;
  ctx.fillStyle = `rgba(0,0,0,${Math.max(0, Math.min(1, darkness))})`;
  ctx.fillRect(0, 0, width, height);
  if (lights.length === 0) return;

  ctx.globalCompositeOperation = 'destination-out';
  for (const light of lights) {
    const cx = (light.x / 100) * width;
    const cy = (light.y / 100) * height;
    const radius = Math.max(1, (light.radius / 100) * width);
    const alpha = Math.max(0, Math.min(1, light.intensity * flickerFactor(light, timeMs)));
    if (alpha <= 0) continue;
    const shape: LightShape = isLightShape(light.shape) ? light.shape : 'circle';
    // O degradê precisa alcançar o vértice mais distante, senão o formato vira um círculo.
    const reach = radius * shapeReach(shape);
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
    gradient.addColorStop(0, `rgba(0,0,0,${alpha})`);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    traceShape(ctx, light, cx, cy, radius);
    ctx.clip();
    if (apertureOf(light) < FULL_APERTURE) {
      traceAperture(ctx, light, cx, cy, reach);
      ctx.clip();
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';
};
