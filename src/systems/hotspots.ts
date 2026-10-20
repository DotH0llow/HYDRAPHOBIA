import type { HotspotDefinition } from '../config/world';

export interface LabelAnchor { x: number; y: number }

/** Tolerância, em %, para considerar duas vértices igualmente "no topo" do contorno. */
const TOP_BAND = 8;

/**
 * Onde a etiqueta de nome de um interagível se ancora, em % da própria área.
 *
 * A etiqueta sobe até a vértice mais próxima do círculo visível, entre as que estão no
 * topo do contorno, e é desenhada acima dela — antes ela caía sobre o objeto em vez de
 * ficar acima dele, escondendo justamente o que o jogador quer ver.
 */
export const labelAnchorOf = (hotspot: Pick<HotspotDefinition, 'indicator' | 'shape'>): LabelAnchor => {
  const indicator = hotspot.indicator ?? { x: 50, y: 50 };
  const points = hotspot.shape?.points ?? [];
  if (points.length === 0) return { x: indicator.x, y: Math.min(indicator.y, 0) };
  const top = points.reduce((lowest, point) => Math.min(lowest, point.y), points[0]!.y);
  const candidates = points.filter((point) => point.y <= top + TOP_BAND);
  const nearest = candidates.reduce((best, point) =>
    Math.abs(point.x - indicator.x) < Math.abs(best.x - indicator.x) ? point : best, candidates[0]!);
  return { x: nearest.x, y: top };
};
