import type { EnemyId } from '../types';

export interface NightDefinition {
  duration: number;
  enemies: Record<EnemyId, number>;
  title: string;
  omen: string;
  tutorial: string[];
}

export const NIGHT_CONFIG: Record<number, NightDefinition> = {
  1: {
    duration: 360,
    enemies: { hollowKnight: 2, veiledWidow: 0, blindMonk: 0 },
    title: 'A Armadura sem Alma',
    omen: 'O ferro caminha onde nenhum homem respira.',
    tutorial: [
      'Abra o espelho para vigiar as seis regiões do castelo.',
      'Passos metálicos anunciam o Cavaleiro no caminho oeste.',
      'Feche o portão oeste apenas quando a ameaça estiver próxima.',
    ],
  },
  2: {
    duration: 360,
    enemies: { hollowKnight: 4, veiledWidow: 3, blindMonk: 0 },
    title: 'Sussurros sob o Véu',
    omen: 'Não confie no silêncio do corredor leste.',
    tutorial: [
      'A Viúva some do espelho, mas seus sussurros revelam proximidade.',
      'Vigie os dois caminhos sem desperdiçar energia.',
    ],
  },
  3: {
    duration: 360,
    enemies: { hollowKnight: 6, veiledWidow: 5, blindMonk: 4 },
    title: 'O Ofício dos Mortos',
    omen: 'Quando o cântico cessar, faça o bronze falar.',
    tutorial: [
      'O Monge Cego não teme portões. Observe seu avanço desde a capela.',
      'Toque o sino quando ele estiver na torre — cedo demais apenas atrai os outros.',
    ],
  },
};

export const LAST_NIGHT = 3;
