/**
 * As chaves do `localStorage`, em um lugar só.
 *
 * Elas moram aqui, e não ao lado de quem as usa, porque a ponte com a cópia local em
 * disco (`systems/localSync`) precisa das duas: importá-las do editor e do save faria
 * um ciclo entre os módulos, e uma das constantes chegaria vazia dependendo de quem
 * carregasse primeiro.
 */

/**
 * Modo isolado.
 *
 * Com `?isolado` no endereço, o editor e o jogo passam a guardar tudo em chaves
 * próprias e param de falar com o disco. É assim que se mexe no jogo sem encostar no
 * mapa que está sendo construído: nada do que acontece aqui aparece no endereço
 * normal, e `data/` não é reescrito nem lido.
 *
 * Isso existe porque a ponte com o disco é de mão dupla. Uma aba aberta numa cópia
 * antiga do projeto empurrava essa cópia para `data/` ao gravar qualquer coisa, e o
 * navegador de quem estava montando o mapa puxava de volta a versão velha: níveis
 * apagados voltavam do nada, no meio do trabalho.
 */
const sandboxRequested = (): boolean => {
  if (typeof window === 'undefined' || !window.location) return false;
  return /(^|[?&#])(isolado|sandbox)(=(1|true))?($|[&#])/i.test(`${window.location.search}${window.location.hash}`);
};

export const SANDBOX = sandboxRequested();

/** As chaves do modo isolado nunca encostam nas de verdade. */
const SUFFIX = SANDBOX ? ':isolado' : '';

/** Projeto do editor de salas. */
export const EDITOR_STORAGE_KEY = `limiar:room-editor:v1${SUFFIX}`;

/** Progresso e configurações do jogador. */
export const SAVE_STORAGE_KEY = `limiar:save:v3${SUFFIX}`;

/** Versão anterior do save, lida uma única vez para migrar o progresso antigo. */
export const LEGACY_SAVE_STORAGE_KEY = 'limiar:save:v2';
