/**
 * Filtro de linguagem do nome do personagem.
 *
 * O nome aparece na lista de registros e nas anotações do jogo, então ele não pode
 * carregar racismo, xenofobia, homofobia, apologia nazista e companhia. O trabalho do
 * filtro é não cair nos disfarces de sempre: trocar letra por número (`n1gg3r`), picar
 * a palavra com pontos (`p.u.t.a`), esticar letras (`viaaaado`) ou colar tudo junto
 * (`filhodaputa`). Para isso o nome é reduzido a três formas antes da comparação — só
 * as letras, as letras com os números traduzidos e essas mesmas letras sem repetição.
 *
 * As listas são separadas de propósito. `CONTAINED` reúne o que não aparece dentro de
 * nenhuma palavra comum e por isso pode ser procurado em qualquer pedaço do nome.
 * `EXACT` reúne o que é curto ou ambíguo e só vale como palavra inteira: "viado" mora
 * dentro de "enviado" e "desviado", "puta" dentro de "disputa" e "reputação", e
 * bloquear por pedaço reprovaria nomes inocentes.
 *
 * O filtro cobre português brasileiro e espanhol latino-americano. Como os acentos caem
 * antes da comparação, "maricón" e "maricon" são a mesma coisa aqui. Três palavras do
 * espanhol ficaram de fora de propósito, porque são nome de gente antes de serem ofensa:
 * "concha" (de Concepción), "jota" (apelido de João no Brasil) e "pinto" (sobrenome
 * comum) — o que se pega delas são as formas compostas, em `CONTAINED`.
 */

/** Dígitos e símbolos que costumam substituir letras. */
const LEET: Readonly<Record<string, string>> = {
  '0': 'o', '1': 'i', '2': 'z', '3': 'e', '4': 'a', '5': 's', '6': 'g', '7': 't', '8': 'b', '9': 'g',
  '@': 'a', '$': 's', '!': 'i', '|': 'i', '¡': 'i', '+': 't', '(': 'c', '<': 'c', 'ß': 'b', 'µ': 'u',
};

/** Termos procurados em qualquer pedaço do nome — nenhum cabe dentro de palavra comum. */
const CONTAINED: readonly string[] = [
  // racismo
  'nigger', 'nigga', 'niggas', 'niggers', 'negrodemerda', 'pretodemerda', 'macacopreto', 'voltapraafrica',
  'crioulo', 'criolo', 'mulatinho', 'senzala', 'escravagista', 'wetback', 'beaner', 'zipperhead',
  // xenofobia
  'nordestinodemerda', 'paraibadmerda', 'voltapraoseupais', 'volteprasuaterra', 'imigrantedemerda',
  'bolivianodemerda', 'venezuelanodemerda', 'haitianodemerda', 'gringodemerda',
  // nazismo e apologia
  'hitler', 'nazista', 'nazismo', 'neonazi', 'heilhitler', 'seigheil', 'fuhrer', 'suastica', 'swastika',
  'terceiroreich', 'thirdreich', 'camaradegas', 'holocausto', 'kukluxklan', 'whitepower', 'supremaciabranca',
  // homofobia e transfobia
  'viadinho', 'viadao', 'veadinho', 'boiola', 'traveco', 'sapatao', 'bichalouca', 'faggot', 'tranny',
  'homofobico', 'morraviado', 'morrabicha',
  // capacitismo
  'retardado', 'retardada', 'mongoloide', 'mongoloid', 'retard',
  // crimes sexuais
  'pedofilo', 'pedofila', 'pedophile', 'estuprador', 'estupro', 'estuprar', 'molestador',
  // palavrões pesados
  'filhodaputa', 'filhadaputa', 'vaitomarnocu', 'vaisefoder', 'vaitomarnoco', 'chupameopau', 'arrombado',
  'arrombada', 'cuzao', 'caralho', 'buceta', 'punheteiro', 'corno manso',
  // português brasileiro: compostos que nenhum nome inocente carrega
  'vaisefuder', 'fiodaputa', 'putaquepariu', 'vaipraputaquepariu', 'vaitomarnabunda', 'putamerda',
  'judeudemerda', 'ciganodemerda', 'indiodemerda', 'morrasapatao', 'morratraveco', 'bichanojenta',
  // espanhol latino-americano: insultos e ofensas de ódio, sempre compostos
  'hijodeputa', 'hijadeputa', 'hijueputa', 'hijodelachingada', 'chingatumadre', 'chingaatumadre',
  'vetealachingada', 'andatealaverga', 'conchatumadre', 'conchadetumadre', 'conchasumadre',
  'negrodemierda', 'indiodemierda', 'sudacademierda', 'cholodemierda', 'nacodemierda',
  'putamadre', 'malparido', 'malparida', 'muerdealmohadas', 'maricones', 'jotito', 'carechimba',
];

/** Termos que só valem como palavra inteira: curtos demais ou ambíguos. */
const EXACT: readonly string[] = [
  // racismo e xenofobia
  'macaco', 'macacos', 'ticao', 'tisao', 'negao', 'chink', 'gook', 'spic', 'paki', 'kike', 'yid', 'gipsy', 'gypsy', 'coon',
  // homofobia e transfobia
  'viado', 'viados', 'veado', 'veados', 'bicha', 'bichas', 'fag', 'fags', 'dyke', 'trava',
  // nazismo
  'nazi', 'reich', 'arianos', 'ariano',
  // palavrões
  'puta', 'putas', 'puto', 'cu', 'xota', 'pica', 'foder', 'fodase', 'merda', 'bosta', 'piranha',
  'vadia', 'vagabunda', 'corno', 'cornos', 'bitch', 'whore', 'slut', 'cunt', 'fuck', 'fucker', 'shit',
  // palavrões e insultos do português brasileiro
  'porra', 'krl', 'crl', 'otario', 'otaria', 'otarios', 'babaca', 'idiota', 'imbecil', 'escroto', 'escrota',
  'desgracado', 'desgracada', 'xoxota', 'boceta', 'cuzinho', 'rola', 'fdp', 'vtnc', 'vsf', 'pqp', 'tnc',
  // palavrões e insultos do espanhol latino-americano
  'mierda', 'pendejo', 'pendeja', 'pendejos', 'cabron', 'cabrona', 'maricon', 'marica', 'joto',
  'boludo', 'boluda', 'pelotudo', 'pelotuda', 'gilipollas', 'culero', 'culera', 'pinche', 'verga',
  'vergas', 'chingada', 'chingar', 'huevon', 'guevon', 'culiao', 'conchudo', 'zorra', 'gonorrea',
  'pirobo', 'cerote', 'culiada',
];

/** Sequências de números com significado próprio, que a tradução de leet destruiria. */
const NUMERIC: readonly string[] = ['1488', '8814', '18 88', '88 hh'];

const stripAccents = (value: string): string => value.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Só as letras do nome, com ou sem os números traduzidos para letras. */
const compact = (value: string, leet: boolean): string => {
  const base = stripAccents(value).toLowerCase();
  const mapped = leet ? [...base].map((character) => LEET[character] ?? character).join('') : base;
  return mapped.replace(leet ? /[^a-z]/g : /[^a-z0-9]/g, '');
};

/** Cada sequência de uma mesma letra vira uma só: `viaaaado` e `viado` ficam iguais. */
const collapse = (value: string): string => value.replace(/(.)\1+/g, '$1');

/** As palavras do nome, já reduzidas a letras. */
const words = (value: string): string[] => {
  const base = stripAccents(value).toLowerCase();
  const mapped = [...base].map((character) => LEET[character] ?? character).join('');
  return mapped.split(/[^a-z]+/).filter(Boolean);
};

export interface NameCheck {
  ok: boolean;
  /** Mensagem pronta para a tela quando o nome é recusado. */
  reason?: string;
}

const REJECTION = 'Nana-nina-não, esse não.';

/**
 * Diz se o nome pode ser usado. Um nome só é recusado quando bate em um termo
 * proibido; qualquer outra coisa passa, inclusive nomes estranhos.
 */
export const checkCharacterName = (value: string): NameCheck => {
  const letters = compact(value, true);
  if (!letters) return { ok: true };
  const digits = compact(value, false);
  const squeezed = collapse(letters);
  const tokens = words(value);
  const tokenSet = new Set([...tokens, ...tokens.map(collapse)]);

  const contained = CONTAINED.some((term) => {
    const clean = term.replace(/[^a-z]/g, '');
    return letters.includes(clean) || squeezed.includes(collapse(clean));
  });
  if (contained) return { ok: false, reason: REJECTION };

  const exact = EXACT.some((term) => {
    const clean = term.replace(/[^a-z]/g, '');
    return tokenSet.has(clean) || tokenSet.has(collapse(clean)) || letters === clean || squeezed === collapse(clean);
  });
  if (exact) return { ok: false, reason: REJECTION };

  const numeric = NUMERIC.some((term) => digits.includes(term.replace(/[^a-z0-9]/g, '')));
  if (numeric) return { ok: false, reason: REJECTION };

  return { ok: true };
};

/** Atalho para quem só precisa do sim ou não. */
export const nameIsAllowed = (value: string): boolean => checkCharacterName(value).ok;
