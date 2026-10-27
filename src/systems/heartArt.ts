/**
 * O desenho da mecânica do coração: a caixa torácica e o próprio coração.
 *
 * Os dois são SVG escritos aqui, e não arquivos em `public/assets`, de propósito: a
 * mecânica precisa poder ser colocada sobre qualquer cena e qualquer entidade sem
 * carregar arte junto. São traços, então escalam para qualquer janela sem borrar, e a
 * cor sai de `currentColor` — a mesma caixa serve a um encontro pálido e a um aceso.
 *
 * As costelas são geradas, não desenhadas à mão: dez pares de arcos que saem da coluna,
 * abrem no meio e voltam ao esterno, fechando mais conforme descem. Escrever isso
 * resolve de uma vez o que seriam duzentas coordenadas num arquivo, e deixa o formato
 * afinável em uma linha.
 */

/** Quantos pares de costelas a caixa tem; as três últimas não chegam ao esterno. */
const RIB_COUNT = 10;
const FLOATING_FROM = RIB_COUNT - 3;

/** O eixo do desenho, no `viewBox` de 180 por 200. */
const SPINE_X = 90;

/**
 * Um par de costelas no nível `index`. Cada lado sai da coluna, desce abrindo até o
 * ponto mais largo e volta em direção ao esterno — o mesmo caminho em dois arcos, que
 * é o que dá à costela a barriga de fora e a ponta virada para dentro. As últimas três
 * param no ar: são as flutuantes, e são elas que deixam a base da caixa aberta.
 */
const ribPair = (index: number): string => {
  const t = index / (RIB_COUNT - 1);
  const start = 34 + t * 86;
  // A largura cresce até a quinta costela e recua depois dela, como na caixa de verdade.
  const half = 26 + Math.sin(Math.PI * (0.26 + t * 0.52)) * 48;
  const drop = 20 + t * 26;
  const end = start + drop;
  const floating = index >= FLOATING_FROM;
  // A costela flutuante morre antes do esterno, e cada uma um pouco mais cedo.
  const endHalf = floating ? half * (0.62 - (index - FLOATING_FROM) * 0.14) : 9;
  const side = (direction: 1 | -1): string => {
    const x = (value: number): number => SPINE_X + value * direction;
    return `M ${x(5)} ${start}`
      + ` C ${x(half * 0.5)} ${start - 1} ${x(half)} ${start + drop * 0.18} ${x(half)} ${start + drop * 0.5}`
      + ` C ${x(half)} ${start + drop * 0.78} ${x(endHalf + half * 0.34)} ${end} ${x(endHalf)} ${end}`;
  };
  return `<path d="${side(1)}" /><path d="${side(-1)}" />`;
};

/** O esterno: o manúbrio, o corpo e o apêndice xifoide na ponta. */
const STERNUM = `
  <path d="M ${SPINE_X - 10} 36 L ${SPINE_X + 10} 36 L ${SPINE_X + 8} 52 L ${SPINE_X - 8} 52 Z" />
  <path d="M ${SPINE_X - 8} 56 L ${SPINE_X + 8} 56 L ${SPINE_X + 6} 124 L ${SPINE_X - 6} 124 Z" />
  <path d="M ${SPINE_X - 4} 128 L ${SPINE_X + 4} 128 L ${SPINE_X} 144 Z" />
`;

/** A clavícula, que fecha a caixa por cima e dá o ombro. */
const CLAVICLE = `
  <path d="M ${SPINE_X - 9} 30 C ${SPINE_X - 32} 18 ${SPINE_X - 58} 18 ${SPINE_X - 72} 28" />
  <path d="M ${SPINE_X + 9} 30 C ${SPINE_X + 32} 18 ${SPINE_X + 58} 18 ${SPINE_X + 72} 28" />
`;

/** A coluna por trás, só sugerida: as vértebras que as costelas encontram. */
const SPINE = Array.from({ length: RIB_COUNT }, (_, index) => {
  const y = 34 + (index / (RIB_COUNT - 1)) * 86;
  return `<path d="M ${SPINE_X - 5} ${y} L ${SPINE_X + 5} ${y}" opacity=".5" />`;
}).join('');

/**
 * A caixa torácica inteira. O desenho é encaixado dentro do mesmo retângulo que a
 * elipse de `CAGE` cobre na cena, então o que está desenhado e o que a mecânica
 * considera "dentro" são a mesma região — mexer em um sem o outro faria o jogador
 * perder por um motivo que ele não consegue ver.
 */
export const RIBCAGE_SVG = `<svg class="heart-cage-art" viewBox="0 0 180 200" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  ${CLAVICLE}
  ${SPINE}
  ${STERNUM}
  ${Array.from({ length: RIB_COUNT }, (_, index) => ribPair(index)).join('')}
</svg>`;

/**
 * O coração. É uma silhueta anatômica — ventrículos embaixo, átrios e os grandes vasos
 * em cima — e não o coração de baralho: a diferença é o que faz a cena doer um pouco.
 */
export const HEART_SVG = `<svg class="heart-art" viewBox="0 0 100 120" aria-hidden="true">
  <path class="heart-vessels" d="M40 24 C36 10 27 4 22 11 C17 19 25 27 32 31 Z M54 20 C57 6 67 3 71 11 C75 20 66 28 59 31 Z" />
  <path class="heart-body" d="M31 27 C17 33 9 49 13 67 C17 87 33 105 51 115 C65 105 79 89 85 69 C91 49 85 31 71 25 C61 21 39 23 31 27 Z" />
  <path class="heart-shade" d="M51 115 C45 97 41 75 43 53 C44 41 47 33 51 27" />
</svg>`;
