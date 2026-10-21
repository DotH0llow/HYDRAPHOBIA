import type { Direction } from '../types';

/**
 * Posição e rotação padrão do botão de um caminho, quando o editor não guardou uma.
 *
 * A cena é enquadrada em 16:9 e ampliada até cobrir a janela, então uma janela mais
 * estreita corta as laterais: em 4:3 só sobra de 12,5% a 87,5% da largura. Os padrões
 * laterais ficavam em 3% e 97%, fora desse corte — o botão existia, era desenhado e
 * nunca chegava à tela, deixando a sala sem aquela saída. Os valores abaixo ficam
 * dentro do que uma janela 4:3 mostra, com folga para a largura do próprio botão.
 *
 * O jogo e o editor leem daqui: o caminho precisa nascer no mesmo ponto nos dois.
 */
export const DEFAULT_PATH_POSITIONS: Readonly<Record<string, { x: number; y: number }>> = {
  forward: { x: 50, y: 16 },
  back: { x: 50, y: 82 },
  left: { x: 16, y: 50 },
  right: { x: 84, y: 50 },
};

export const defaultPathPosition = (direction: Direction): { x: number; y: number } =>
  DEFAULT_PATH_POSITIONS[direction] ?? { x: 50, y: 50 };

const DEFAULT_PATH_ROTATIONS: Readonly<Record<string, number>> = { forward: 0, back: 180, left: 270, right: 90 };

export const defaultArrowRotation = (direction: Direction): number => DEFAULT_PATH_ROTATIONS[direction] ?? 45;
