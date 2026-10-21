/**
 * As chaves do `localStorage`, em um lugar só.
 *
 * Elas moram aqui, e não ao lado de quem as usa, porque a ponte com a cópia local em
 * disco (`systems/localSync`) precisa das duas: importá-las do editor e do save faria
 * um ciclo entre os módulos, e uma das constantes chegaria vazia dependendo de quem
 * carregasse primeiro.
 */

/** Projeto do editor de salas. */
export const EDITOR_STORAGE_KEY = 'limiar:room-editor:v1';

/** Progresso e configurações do jogador. */
export const SAVE_STORAGE_KEY = 'limiar:save:v3';

/** Versão anterior do save, lida uma única vez para migrar o progresso antigo. */
export const LEGACY_SAVE_STORAGE_KEY = 'limiar:save:v2';
