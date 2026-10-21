/** Pasta em disco onde a cópia local do mapa e do progresso é mantida. */
export declare const DATA_DIR: string;

/**
 * Plugin do Vite que expõe `/__local/project`, `/__local/progress` e `/__local/push`
 * no servidor de desenvolvimento, para o navegador manter `data/` em dia e enviar o
 * que foi editado para a main.
 */
export declare const localSyncPlugin: () => { name: string; apply: 'serve' };

export default localSyncPlugin;
