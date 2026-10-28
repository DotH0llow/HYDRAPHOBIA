/**
 * A arte da mecânica do coração: a caixa torácica e o próprio coração.
 *
 * Os dois eram SVG escritos à mão aqui. Agora são dois PNG recortados do gif que deu
 * origem à cena — a gravura das costelas e o coração anatômico vermelho, com o fundo
 * tirado fora. A troca vale a pena porque o desenho gerado nunca ia bater com a
 * referência: o que se vê no jogo e o que se vê no gif são, agora, a mesma imagem.
 *
 * Continuam sendo arte solta, sem nada por trás: a mecânica põe as duas sobre qualquer
 * cena e qualquer entidade, e só precisa saber onde elas ficam.
 */

/** A caixa torácica. As proporções do arquivo são as que `CAGE` mede na cena. */
export const RIBCAGE_IMAGE = '/assets/props/ribcage.png';

/** O coração, recortado com a transparência que o gif não tinha. */
export const HEART_IMAGE = '/assets/props/heart.png';

export const RIBCAGE_ART = `<img class="heart-cage-art" src="${RIBCAGE_IMAGE}" alt="" aria-hidden="true" />`;

export const HEART_ART = `<img class="heart-art" src="${HEART_IMAGE}" alt="" aria-hidden="true" />`;
