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
