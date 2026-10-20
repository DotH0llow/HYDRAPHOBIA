export declare const collectAudioFiles: (root?: string) => string[];

export declare const writeAudioManifest: (options?: { root?: string; output?: string; quiet?: boolean }) => { files: string[]; changed: boolean };

/** Plugin do Vite que mantém public/assets/audio/manifest.json sincronizado com as pastas. */
export declare const audioManifestPlugin: () => { name: string };
