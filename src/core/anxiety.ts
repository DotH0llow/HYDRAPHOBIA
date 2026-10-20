export type AnxietyTier = 'calm' | 'uneasy' | 'terrified';

export interface AnxietyTierDefinition {
  id: AnxietyTier;
  label: string;
  /** Faixa do medidor (0-100) que corresponde ao nível. */
  min: number;
  max: number;
}

/** Os três únicos níveis de ansiedade do jogo. */
export const ANXIETY_TIERS: readonly AnxietyTierDefinition[] = [
  { id: 'calm', label: 'CALMA', min: 0, max: 35 },
  { id: 'uneasy', label: 'INQUIETO', min: 36, max: 79 },
  { id: 'terrified', label: 'TERROR', min: 80, max: 100 },
];

export const anxietyTier = (value: number): AnxietyTier => {
  if (value >= 80) return 'terrified';
  if (value >= 36) return 'uneasy';
  return 'calm';
};

export const anxietyTierLabel = (value: number): string =>
  ANXIETY_TIERS.find((tier) => tier.id === anxietyTier(value))!.label;

/**
 * Valor em que cada nível começa. Serve para um evento colocar o personagem
 * exatamente no início de um nível, sem herdar o quanto ele já estava carregado.
 */
export const anxietyTierStart = (tier: AnxietyTier): number =>
  ANXIETY_TIERS.find((entry) => entry.id === tier)!.min;

/**
 * Sobe um nível de ansiedade e devolve o valor inicial do nível seguinte:
 * calma → inquieto → terror. No último nível o medidor fica onde está, já que
 * não há para onde subir.
 */
export const escalateAnxiety = (value: number): number => {
  const index = ANXIETY_TIERS.findIndex((entry) => entry.id === anxietyTier(value));
  const next = ANXIETY_TIERS[index + 1];
  return next ? Math.max(value, next.min) : value;
};
