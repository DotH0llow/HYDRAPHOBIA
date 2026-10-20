import { describe, expect, it } from 'vitest';
import { ANXIETY_TIERS, anxietyTier, anxietyTierLabel } from '../src/core/anxiety';
import {
  buildLibrary, categoryOf, configFor, FX_ANXIETY, FX_HUNGER, FX_HUNGER_LOW, FX_HURT, FX_LOW_HEALTH, FX_MEME, FX_PANIC_ATTACK,
  FX_SAFE_ROOM, FX_SCREAM, FX_THIRST, FX_THIRST_LOW, isLevelZero, isRareClip, MUSIC_LOBBY, MUSIC_MENU, selectClip,
} from '../src/systems/audioLibrary';
import { collectAudioFiles } from '../scripts/audioManifest.mjs';

describe('níveis de ansiedade', () => {
  it('tem exatamente três níveis cobrindo 0-100', () => {
    expect(ANXIETY_TIERS).toHaveLength(3);
    expect(ANXIETY_TIERS[0]!.min).toBe(0);
    expect(ANXIETY_TIERS[2]!.max).toBe(100);
  });

  it('usa as faixas calma 0-35, inquieto 36-79 e terror 80-100', () => {
    expect(anxietyTier(0)).toBe('calm');
    expect(anxietyTier(35)).toBe('calm');
    expect(anxietyTier(36)).toBe('uneasy');
    expect(anxietyTier(79)).toBe('uneasy');
    expect(anxietyTier(80)).toBe('terrified');
    expect(anxietyTier(100)).toBe('terrified');
  });

  it('rotula cada nível', () => {
    expect(anxietyTierLabel(10)).toBe('CALMA');
    expect(anxietyTierLabel(50)).toBe('INQUIETO');
    expect(anxietyTierLabel(95)).toBe('TERROR');
  });
});

describe('catálogo de áudio', () => {
  it('classifica cada pasta na categoria correspondente', () => {
    expect(categoryOf('/assets/audio/Music/Menu/Escape the Backrooms OST - The Menu.mp3')).toBe(MUSIC_MENU);
    expect(categoryOf('/assets/audio/Music/Ambient/LV0_lobby/lobby_lights (1).mp3')).toBe(MUSIC_LOBBY);
    expect(categoryOf('/assets/audio/FX/Anxiety/female_gasp_entering_safe_room1.mp3')).toBe(FX_SAFE_ROOM);
    expect(categoryOf('/assets/audio/FX/Anxiety/female_shivering_panicattack.mp3')).toBe(FX_PANIC_ATTACK);
    expect(categoryOf('/assets/audio/FX/Anxiety/respiracao_nova.mp3')).toBe(FX_ANXIETY);
    expect(categoryOf('/assets/audio/FX/Hunger/HUNGER_growl1.mp3')).toBe(FX_HUNGER);
    expect(categoryOf('/assets/audio/FX/Hunger/HUNGER_LOW_growl1.mp3')).toBe(FX_HUNGER_LOW);
    expect(categoryOf('/assets/audio/FX/Thirst/THIRST_woman clearing throat1.mp3')).toBe(FX_THIRST);
    expect(categoryOf('/assets/audio/FX/Thirst/THIRST_LOW_woman clearing throat1.mp3')).toBe(FX_THIRST_LOW);
    expect(categoryOf('/assets/audio/FX/Low Health/heartbeat_1.mp3')).toBe(FX_LOW_HEALTH);
    expect(categoryOf('/assets/audio/FX/Getting Hurt/fast_heartbeat (1).mp3')).toBe(FX_HURT);
    expect(categoryOf('/assets/audio/FX/Screams/scream1.mp3')).toBe(FX_SCREAM);
    expect(categoryOf('/assets/audio/Memes HYDRA/MAKITA.ogg')).toBe(FX_MEME);
  });

  it('ignora as antigas pastas de ansiedade por nível e caminhos de fora', () => {
    expect(categoryOf('/assets/audio/FX/Anxiety/LV2_UNEASY/qualquer.mp3')).toBeNull();
    expect(categoryOf('/assets/scenes/reception.jpg')).toBeNull();
  });

  it('reconhece os arquivos marcados como "rare"', () => {
    expect(isRareClip('/assets/audio/FX/Anxiety/ANXIETY_UNEASY_male_humming_1_rare.ogg')).toBe(true);
    expect(isRareClip('/assets/audio/FX/Hunger/HUNGER_growl1.mp3')).toBe(false);
    expect(configFor(FX_SAFE_ROOM).rareChance).toBeLessThanOrEqual(0.01);
  });

  it('agrupa o manifesto real por categoria', () => {
    const library = buildLibrary(collectAudioFiles());
    expect(library.get(MUSIC_LOBBY)?.length).toBeGreaterThanOrEqual(2);
    expect(library.get(FX_SAFE_ROOM)?.length).toBeGreaterThanOrEqual(2);
    expect(library.get(FX_PANIC_ATTACK)?.length).toBeGreaterThanOrEqual(1);
    expect(library.get(MUSIC_MENU)?.length).toBe(1);
    // Os sons de ansiedade por nível foram removidos do jogo.
    expect(library.get(FX_ANXIETY)).toBeUndefined();
  });

  it('toda categoria tem fade de saída e variação de afinação', () => {
    [MUSIC_MENU, MUSIC_LOBBY, FX_SAFE_ROOM, FX_PANIC_ATTACK, FX_HURT, FX_SCREAM, FX_MEME, FX_THIRST, FX_HUNGER, FX_LOW_HEALTH].forEach((category) => {
      const config = configFor(category);
      expect(config.fadeOutMs).toBeGreaterThan(0);
      expect(config.pitch).toBeGreaterThan(0);
      expect(config.gapMs[1]).toBeGreaterThan(config.gapMs[0]);
      expect(config.cooldownMs).toBeGreaterThan(0);
    });
  });

  it('identifica salas do nível 0 pelo nível, pelo código ou pela pasta da imagem', () => {
    expect(isLevelZero('Nível 0')).toBe(true);
    expect(isLevelZero(undefined, 'NÍVEL 0 — R.01')).toBe(true);
    expect(isLevelZero(undefined, undefined, '/assets/scenes/00_Nivel_0_Lobby/sala.jpg')).toBe(true);
    expect(isLevelZero('Nível 3', 'NÍVEL 3 — C.02', '/assets/scenes/03_Nivel_3_Estacao_Eletrica/sala.jpg')).toBe(false);
    expect(isLevelZero('Nível 10', 'NÍVEL 10 — X.01')).toBe(false);
  });
});

describe('sorteio dos arquivos', () => {
  const clips = [
    { path: 'a.mp3', category: FX_THIRST, rare: false },
    { path: 'b.mp3', category: FX_THIRST, rare: false },
    { path: 'c.mp3', category: FX_THIRST, rare: false },
    { path: 'raro_rare.mp3', category: FX_THIRST, rare: true },
  ];

  it('nunca repete o mesmo arquivo mais de duas vezes seguidas', () => {
    const config = configFor(FX_THIRST);
    let history: string[] = [];
    const played: string[] = [];
    for (let index = 0; index < 500; index += 1) {
      const clip = selectClip(clips, history, config)!;
      played.push(clip.path);
      history = [...history, clip.path].slice(-2);
    }
    for (let index = 2; index < played.length; index += 1) {
      expect(played[index] === played[index - 1] && played[index] === played[index - 2]).toBe(false);
    }
  });

  it('só escolhe arquivos "rare" dentro da chance configurada', () => {
    const config = configFor(FX_THIRST);
    const always = selectClip(clips, [], config, () => 0);
    expect(always!.rare).toBe(true);
    const never = selectClip(clips, [], config, () => 0.5);
    expect(never!.rare).toBe(false);
    let rareCount = 0;
    for (let index = 0; index < 2000; index += 1) if (selectClip(clips, [], config)!.rare) rareCount += 1;
    expect(rareCount / 2000).toBeLessThan(0.05);
  });

  it('aceita categorias com um único arquivo', () => {
    const single = [{ path: 'unico.mp3', category: FX_PANIC_ATTACK, rare: false }];
    expect(selectClip(single, ['unico.mp3', 'unico.mp3'], configFor(FX_PANIC_ATTACK))!.path).toBe('unico.mp3');
    expect(selectClip([], [], configFor(FX_PANIC_ATTACK))).toBeNull();
  });
});
