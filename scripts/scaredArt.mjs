/**
 * A arte de "quem está vendo isso": o personagem do jogador, encostado na parede,
 * assustado, com as duas mãos tapando a boca.
 *
 * A pose vem do gif que deu origem ao encontro — mãos sobre a boca, um olho arregalado
 * e o outro apertado. O traço, não: o gif é anime, e as oito classes do jogo já são
 * silhuetas de contraluz (`public/assets/characters`). Desenhar mais um anime ali
 * dentro ia parecer colado de outro jogo, então o que se vê é uma silhueta quase preta
 * contra a parede, com só os olhos acesos. É também o que funciona numa cena em que a
 * única coisa que brilha é a caixa torácica.
 *
 * São oito arquivos porque são quatro classes em dois gêneros, e o jogo escolhe pelo
 * personagem que o jogador criou. O que muda entre eles é a silhueta: o cabelo, a
 * largura do ombro e um traço de cada classe (a alça da mochila, o capuz, a gola). O
 * corpo e a pose são os mesmos oito vezes, de propósito — é a mesma pessoa, com medo.
 *
 * Isto é um gerador, e não um arquivo desenhado à mão, porque oito variações do mesmo
 * desenho feitas à mão saem diferentes umas das outras sem ninguém querer. Rodar:
 *
 *   node scripts/scaredArt.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'characters', 'scared');

/** O quadro do desenho. 3:4 em pé, como a parede em que ele é colado. */
const W = 600;
const H = 800;

/** O eixo do corpo e as alturas de que todo o resto depende. */
const MID = W / 2;
const HEAD_Y = 322;
const HEAD_RX = 112;
const HEAD_RY = 134;

/**
 * Uma mão sobre a boca. O que faz uma mancha escura virar mão é o contorno de cima:
 * quatro arcos seguidos, um por dedo, subindo na direção do nariz. Sem essa fieira de
 * pontas as duas mãos juntas viravam uma máscara cirúrgica, que era o oposto da cena.
 *
 * `side` é -1 para a mão da esquerda e 1 para a da direita; a de cima é desenhada por
 * último, e é a sobreposição delas que dá o gesto de abafar o próprio grito.
 */
const FINGERS = 4;
const hand = (side) => {
  const inner = MID - side * 14;   // o dorso, quase no eixo do rosto
  const outer = MID + side * 122;  // o mindinho, já na bochecha
  const tipHigh = 356;             // o indicador, logo abaixo do olho
  const tipLow = 410;              // o mindinho, mais baixo: a mão entra torta
  const wrist = 548;
  const span = outer - inner;
  let palm = `M ${inner} ${tipHigh + 22}`;
  const valleys = [];
  for (let i = 0; i < FINGERS; i += 1) {
    const x0 = inner + span * (i / FINGERS);
    const x1 = inner + span * ((i + 1) / FINGERS);
    const y0 = tipHigh + (tipLow - tipHigh) * (i / FINGERS);
    const y1 = tipHigh + (tipLow - tipHigh) * ((i + 1) / FINGERS);
    palm += ` C ${x0} ${y0 - 26} ${x1} ${y1 - 30} ${x1} ${y1}`;
    valleys.push({ x: x1, y: y1 });
  }
  palm += ` C ${outer + side * 20} ${tipLow + 64} ${outer + side * 12} ${wrist - 46} ${outer - side * 30} ${wrist}`
    + ` C ${MID + side * 40} ${wrist + 20} ${inner - side * 4} ${wrist + 8} ${inner - side * 2} ${wrist - 10}`
    + ` C ${inner - side * 14} ${wrist - 78} ${inner - side * 8} ${tipHigh + 90} ${inner} ${tipHigh + 22} Z`;
  // O vinco desce de cada vão entre dois dedos; é o que separa um do outro.
  const creases = valleys.slice(0, FINGERS - 1).map(({ x, y }) =>
    `M ${x} ${y + 6} C ${x + side * 6} ${y + 58} ${x + side * 4} ${y + 96} ${x - side * 6} ${y + 128}`).join(' ');
  return { palm, creases };
};

/**
 * Os olhos. O direito arregalado e o esquerdo espremido, como no gif: é o par
 * desencontrado que faz a cara ser de medo e não de surpresa.
 */
const EYES = `
  <g class="eyes">
    <ellipse cx="${MID + 48}" cy="${HEAD_Y - 8}" rx="27" ry="33" />
    <path class="shut" d="M ${MID - 84} ${HEAD_Y - 4} C ${MID - 66} ${HEAD_Y - 26} ${MID - 32} ${HEAD_Y - 26} ${MID - 16} ${HEAD_Y - 6}" />
  </g>
  <ellipse class="pupil" cx="${MID + 52}" cy="${HEAD_Y}" rx="10" ry="13" />
`;

/**
 * Cada variação: o cabelo, a largura do ombro e o traço da classe. Tudo em volta do
 * mesmo corpo — quem muda é a borda da pessoa, que é o que se enxerga no escuro.
 */
const VARIANTS = {
  explorador: {
    male: {
      shoulder: 252,
      hair: `M ${MID - HEAD_RX - 6} ${HEAD_Y - 28} C ${MID - 108} ${HEAD_Y - 150} ${MID + 104} ${HEAD_Y - 156} ${MID + HEAD_RX + 4} ${HEAD_Y - 24}`
        + ` C ${MID + 92} ${HEAD_Y - 96} ${MID + 30} ${HEAD_Y - 72} ${MID - 18} ${HEAD_Y - 100}`
        + ` C ${MID - 54} ${HEAD_Y - 72} ${MID - 86} ${HEAD_Y - 78} ${MID - HEAD_RX - 6} ${HEAD_Y - 28} Z`,
      // A alça da mochila, atravessando o peito: o traço de quem anda carregando tudo.
      mark: `M ${MID - 168} 706 L ${MID + 36} 800 M ${MID - 150} 662 L ${MID + 78} 768`,
    },
    female: {
      shoulder: 226,
      hair: `M ${MID - HEAD_RX - 4} ${HEAD_Y - 30} C ${MID - 104} ${HEAD_Y - 154} ${MID + 100} ${HEAD_Y - 158} ${MID + HEAD_RX + 2} ${HEAD_Y - 26}`
        + ` C ${MID + 150} ${HEAD_Y + 110} ${MID + 128} ${HEAD_Y + 196} ${MID + 112} ${HEAD_Y + 250}`
        + ` L ${MID + 60} ${HEAD_Y + 236} C ${MID + 92} ${HEAD_Y + 120} ${MID + 86} ${HEAD_Y + 10} ${MID + 54} ${HEAD_Y - 88}`
        + ` C ${MID - 10} ${HEAD_Y - 58} ${MID - 70} ${HEAD_Y - 66} ${MID - HEAD_RX - 4} ${HEAD_Y - 30} Z`,
      mark: `M ${MID - 160} 710 L ${MID + 30} 800 M ${MID - 142} 668 L ${MID + 68} 772`,
    },
  },
  tecnico: {
    male: {
      shoulder: 262,
      // Cabelo curto e colado, e a aba de um boné achatado sobre a testa.
      hair: `M ${MID - HEAD_RX - 2} ${HEAD_Y - 36} C ${MID - 110} ${HEAD_Y - 146} ${MID + 106} ${HEAD_Y - 148} ${MID + HEAD_RX} ${HEAD_Y - 34}`
        + ` C ${MID + 112} ${HEAD_Y - 10} ${MID - 112} ${HEAD_Y - 8} ${MID - HEAD_RX - 2} ${HEAD_Y - 36} Z`,
      // A gola dura do macacão, levantada dos dois lados.
      mark: `M ${MID - 110} 800 C ${MID - 92} 690 ${MID - 54} 668 ${MID} 730 C ${MID + 54} 668 ${MID + 92} 690 ${MID + 110} 800`,
    },
    female: {
      shoulder: 230,
      // O coque preso no alto, que é como ela trabalha.
      hair: `M ${MID - HEAD_RX - 4} ${HEAD_Y - 30} C ${MID - 106} ${HEAD_Y - 150} ${MID + 102} ${HEAD_Y - 152} ${MID + HEAD_RX + 2} ${HEAD_Y - 28}`
        + ` C ${MID + 78} ${HEAD_Y - 102} ${MID - 76} ${HEAD_Y - 102} ${MID - HEAD_RX - 4} ${HEAD_Y - 30} Z`
        + ` M ${MID - 44} ${HEAD_Y - 168} C ${MID - 44} ${HEAD_Y - 214} ${MID + 44} ${HEAD_Y - 214} ${MID + 44} ${HEAD_Y - 168}`
        + ` C ${MID + 44} ${HEAD_Y - 130} ${MID - 44} ${HEAD_Y - 130} ${MID - 44} ${HEAD_Y - 168} Z`,
      mark: `M ${MID - 102} 800 C ${MID - 86} 696 ${MID - 50} 674 ${MID} 734 C ${MID + 50} 674 ${MID + 86} 696 ${MID + 102} 800`,
    },
  },
  adolescente: {
    male: {
      shoulder: 244,
      // O capuz levantado: a silhueta inteira dele é o capuz.
      hair: `M ${MID - HEAD_RX - 56} ${HEAD_Y + 110} C ${MID - 180} ${HEAD_Y - 102} ${MID - 96} ${HEAD_Y - 212} ${MID} ${HEAD_Y - 212}`
        + ` C ${MID + 96} ${HEAD_Y - 212} ${MID + 180} ${HEAD_Y - 102} ${MID + HEAD_RX + 56} ${HEAD_Y + 110}`
        + ` C ${MID + 120} ${HEAD_Y + 36} ${MID + 112} ${HEAD_Y - 62} ${MID} ${HEAD_Y - 70}`
        + ` C ${MID - 112} ${HEAD_Y - 62} ${MID - 120} ${HEAD_Y + 36} ${MID - HEAD_RX - 56} ${HEAD_Y + 110} Z`,
      mark: '',
    },
    female: {
      shoulder: 222,
      // O mesmo capuz, com o cabelo escapando por baixo dele de um lado só.
      hair: `M ${MID - HEAD_RX - 54} ${HEAD_Y + 106} C ${MID - 178} ${HEAD_Y - 104} ${MID - 94} ${HEAD_Y - 210} ${MID} ${HEAD_Y - 210}`
        + ` C ${MID + 94} ${HEAD_Y - 210} ${MID + 178} ${HEAD_Y - 104} ${MID + HEAD_RX + 54} ${HEAD_Y + 106}`
        + ` C ${MID + 120} ${HEAD_Y + 34} ${MID + 112} ${HEAD_Y - 64} ${MID} ${HEAD_Y - 72}`
        + ` C ${MID - 112} ${HEAD_Y - 64} ${MID - 120} ${HEAD_Y + 34} ${MID - HEAD_RX - 54} ${HEAD_Y + 106} Z`
        + ` M ${MID - 152} ${HEAD_Y + 72} C ${MID - 148} ${HEAD_Y + 182} ${MID - 136} ${HEAD_Y + 244} ${MID - 128} ${HEAD_Y + 290}`
        + ` L ${MID - 78} ${HEAD_Y + 284} C ${MID - 94} ${HEAD_Y + 206} ${MID - 100} ${HEAD_Y + 134} ${MID - 100} ${HEAD_Y + 66} Z`,
      mark: '',
    },
  },
  cavaleiro: {
    male: {
      shoulder: 272,
      // Cabelo raspado e a gola alta da cota: o pescoço quase não aparece.
      hair: `M ${MID - HEAD_RX} ${HEAD_Y - 40} C ${MID - 100} ${HEAD_Y - 140} ${MID + 96} ${HEAD_Y - 142} ${MID + HEAD_RX - 2} ${HEAD_Y - 38}`
        + ` C ${MID + 72} ${HEAD_Y - 104} ${MID - 70} ${HEAD_Y - 104} ${MID - HEAD_RX} ${HEAD_Y - 40} Z`,
      // O escudo encostado atras do ombro, e a gola alta da cota sobre o peito.
      behind: `M ${MID + 164} 800 C ${MID + 134} 664 ${MID + 182} 554 ${MID + 256} 540 C ${MID + 300} 614 ${MID + 304} 716 ${MID + 282} 800 Z`,
      mark: `M ${MID - 112} 782 C ${MID - 72} 666 ${MID + 72} 666 ${MID + 112} 782`
        + ` M ${MID + 186} 800 C ${MID + 168} 684 ${MID + 198} 604 ${MID + 250} 592`
        + ` M ${MID + 164} 648 L ${MID + 294} 668`,
    },
    female: {
      shoulder: 238,
      // A trança presa para trás, e a mesma gola alta.
      hair: `M ${MID - HEAD_RX - 2} ${HEAD_Y - 32} C ${MID - 104} ${HEAD_Y - 148} ${MID + 100} ${HEAD_Y - 150} ${MID + HEAD_RX} ${HEAD_Y - 30}`
        + ` C ${MID + 76} ${HEAD_Y - 106} ${MID - 74} ${HEAD_Y - 106} ${MID - HEAD_RX - 2} ${HEAD_Y - 32} Z`
        + ` M ${MID + 92} ${HEAD_Y - 22} C ${MID + 150} ${HEAD_Y + 60} ${MID + 150} ${HEAD_Y + 170} ${MID + 132} ${HEAD_Y + 254}`
        + ` L ${MID + 84} ${HEAD_Y + 242} C ${MID + 104} ${HEAD_Y + 162} ${MID + 102} ${HEAD_Y + 58} ${MID + 62} ${HEAD_Y - 6} Z`,
      behind: `M ${MID + 158} 800 C ${MID + 130} 672 ${MID + 176} 566 ${MID + 248} 552 C ${MID + 290} 624 ${MID + 294} 720 ${MID + 274} 800 Z`,
      mark: `M ${MID - 106} 784 C ${MID - 68} 674 ${MID + 68} 674 ${MID + 106} 784`
        + ` M ${MID + 180} 800 C ${MID + 162} 690 ${MID + 192} 614 ${MID + 242} 602`
        + ` M ${MID + 158} 658 L ${MID + 286} 678`,
    },
  },
};

/**
 * O tronco e o pescoço num contorno só. Separados, o pescoço aparecia como uma caixa
 * desenhada por cima do peito — a emenda entre os dois ficava à vista, e o que se via
 * era um boneco montado de peças em vez de uma pessoa.
 */
const torso = (shoulder) => `M ${MID - shoulder} 800`
  + ` C ${MID - shoulder + 12} 686 ${MID - 158} 606 ${MID - 56} 580`
  + ` C ${MID - 50} 562 ${MID - 48} ${HEAD_Y + 110} ${MID - 46} ${HEAD_Y + 80}`
  + ` L ${MID + 46} ${HEAD_Y + 80}`
  + ` C ${MID + 48} ${HEAD_Y + 110} ${MID + 50} 562 ${MID + 56} 580`
  + ` C ${MID + 158} 606 ${MID + shoulder - 12} 686 ${MID + shoulder} 800 Z`;

const svg = (variant) => {
  const left = hand(-1);
  const right = hand(1);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <!-- A luz vem de trás e de cima, como nas outras artes do jogo: a borda acende, o resto não. -->
    <linearGradient id="rim" x1="0" y1="0" x2="1" y2="0.35">
      <stop offset="0" stop-color="#0a0c0a" />
      <stop offset=".46" stop-color="#101310" />
      <stop offset="1" stop-color="#1d2017" />
    </linearGradient>
  </defs>
  <style>
    .body { fill: url(#rim); stroke: #6d7154; stroke-width: 2.4; stroke-linejoin: round; }
    .behind { fill: #080a08; stroke: #4e5240; stroke-width: 2.2; stroke-linejoin: round; }
    .mark { fill: none; stroke: #5f6349; stroke-width: 3.4; stroke-linecap: round; stroke-linejoin: round; }
    .crease { fill: none; stroke: #585c43; stroke-width: 2; stroke-linecap: round; opacity: .8; }
    .eyes ellipse { fill: #e9ead6; }
    .eyes .shut { fill: none; stroke: #c8c9b2; stroke-width: 7; stroke-linecap: round; }
    .pupil { fill: #14160f; }
  </style>
  ${variant.behind ? `<path class="behind" d="${variant.behind}" />` : ''}
  <path class="body" d="${torso(variant.shoulder)}" />
  <ellipse class="body" cx="${MID}" cy="${HEAD_Y}" rx="${HEAD_RX}" ry="${HEAD_RY}" />
  <path class="body" d="${variant.hair}" />
  ${EYES}
  <path class="body" d="${left.palm}" />
  <path class="crease" d="${left.creases}" />
  <path class="body" d="${right.palm}" />
  <path class="crease" d="${right.creases}" />
  ${variant.mark ? `<path class="mark" d="${variant.mark}" />` : ''}
</svg>
`;
};

await mkdir(OUT, { recursive: true });
for (const [classId, genders] of Object.entries(VARIANTS)) {
  for (const [gender, variant] of Object.entries(genders)) {
    const file = join(OUT, `${classId}_${gender}.svg`);
    await writeFile(file, svg(variant), 'utf8');
    console.log('escrito', file);
  }
}
