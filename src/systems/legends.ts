/**
 * Legendas do jogo: quanto tempo cada uma fica na tela e onde um texto longo se parte.
 *
 * Uma legenda sozinha continua com os oito segundos de sempre — ela é a única coisa
 * para ler e não há nada esperando a vez. Quando um texto é longo demais ele vira uma
 * sequência, e aí cada pedaço tem o tempo do próprio tamanho: segurar todos por oito
 * segundos faria o jogador esperar meio minuto por uma frase.
 */

/** Uma legenda sozinha fica oito segundos na tela. */
export const SOLO_LEGEND_MS = 8000;

/** Acima deste tamanho a legenda é dividida. */
export const MAX_LEGEND_CHARS = 80;

/**
 * Duração de uma legenda dentro de uma sequência, pelo tamanho do texto. Cada faixa
 * usa o meio do intervalo recomendado: até 20 caracteres 1,8–2 s; 21–40, 2–3 s;
 * 41–60, 3–4,5 s; 61–80, 4,5–6 s.
 */
export const legendDurationMs = (text: string): number => {
  const length = text.trim().length;
  if (length <= 20) return 1900;
  if (length <= 40) return 2500;
  if (length <= 60) return 3750;
  return 5250;
};

/** Divide o texto em pedaços de até `limit` caracteres, sempre entre palavras. */
const fill = (words: readonly string[], limit: number): string[] => {
  const parts: string[] = [];
  let current = '';
  words.forEach((word) => {
    if (!current) { current = word; return; }
    if (current.length + 1 + word.length <= limit) { current = `${current} ${word}`; return; }
    parts.push(current);
    current = word;
  });
  if (current) parts.push(current);
  return parts;
};

/** Uma palavra maior que o limite não cabe em lugar nenhum: é cortada no limite. */
const breakLongWords = (words: readonly string[]): string[] => words.flatMap((word) => {
  if (word.length <= MAX_LEGEND_CHARS) return [word];
  const pieces: string[] = [];
  for (let start = 0; start < word.length; start += MAX_LEGEND_CHARS) pieces.push(word.slice(start, start + MAX_LEGEND_CHARS));
  return pieces;
});

/**
 * O texto da legenda em pedaços. Até 80 caracteres ele fica inteiro; acima disso é
 * repartido no menor número possível de legendas, todas com tamanho parecido, para
 * não sobrar uma linha cheia seguida de duas palavras soltas.
 */
export const splitLegend = (message: string): string[] => {
  const text = message.trim().replace(/\s+/g, ' ');
  if (!text) return [];
  if (text.length <= MAX_LEGEND_CHARS) return [text];
  const words = breakLongWords(text.split(' '));
  const count = fill(words, MAX_LEGEND_CHARS).length;
  // Com o número de pedaços conhecido, o mesmo texto é redistribuído por igual.
  const balanced = fill(words, Math.max(1, Math.ceil(text.length / count)));
  return balanced.length === count ? balanced : fill(words, MAX_LEGEND_CHARS);
};

/** O tempo de tela de cada pedaço: sozinho são oito segundos, em sequência a tabela. */
export const legendTimings = (parts: readonly string[]): number[] =>
  parts.length <= 1 ? parts.map(() => SOLO_LEGEND_MS) : parts.map((part) => legendDurationMs(part));
