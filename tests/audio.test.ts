import { describe, expect, it } from 'vitest';
import { ANXIETY_TIERS, anxietyTier, anxietyTierLabel, anxietyTierStart, escalateAnxiety } from '../src/core/anxiety';
import {
  anxietyCategoryFor, buildLibrary, categoryOf, clipGain, clipGenderOf, clipsForGender, configFor, FX_ANXIETY_CALM,
  FX_ANXIETY_TERRIFIED, FX_ANXIETY_UNEASY, FX_HUNGER, FX_HUNGER_LOW, FX_HURT, FX_LOW_HEALTH, FX_PANIC_ATTACK,
  FX_SAFE_ROOM, FX_SCREAM, FX_THIRST, FX_THIRST_LOW, isLevelZero, isRareClip, isVoiceCategory, MUSIC_LOBBY, MUSIC_MENU,
  selectClip, VOICE_GROUP, VOICE_SPACING_FACTOR,
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

  it('conhece o valor em que cada nível começa', () => {
    expect(anxietyTierStart('calm')).toBe(0);
    expect(anxietyTierStart('uneasy')).toBe(36);
    expect(anxietyTierStart('terrified')).toBe(80);
  });

  it('sobe um nível de cada vez, começando no valor inicial do nível seguinte', () => {
    expect(escalateAnxiety(0)).toBe(36);
    expect(escalateAnxiety(35)).toBe(36);
    expect(escalateAnxiety(36)).toBe(80);
    expect(escalateAnxiety(79)).toBe(80);
    // No topo não há próximo nível: o valor acumulado é preservado.
    expect(escalateAnxiety(80)).toBe(80);
    expect(escalateAnxiety(95)).toBe(95);
  });
});

describe('catálogo de áudio', () => {
  it('classifica cada pasta na categoria correspondente', () => {
    expect(categoryOf('/assets/audio/Music/Menu/Escape the Backrooms OST - The Menu.mp3')).toBe(MUSIC_MENU);
    expect(categoryOf('/assets/audio/Music/Ambient/LV0_lobby/lobby_lights (1).mp3')).toBe(MUSIC_LOBBY);
    expect(categoryOf('/assets/audio/FX/Anxiety/female_gasp_entering_safe_room1.mp3')).toBe(FX_SAFE_ROOM);
    expect(categoryOf('/assets/audio/FX/Anxiety/female_shivering_panicattack.mp3')).toBe(FX_PANIC_ATTACK);
    expect(categoryOf('/assets/audio/FX/Anxiety/LV1_CALM/ANXIETY_CALM_male_sigh1.mp3')).toBe(FX_ANXIETY_CALM);
    expect(categoryOf('/assets/audio/FX/Anxiety/LV2_UNEASY/ANXIETY_MALE_BREATHING_UNEASY_1.mp3')).toBe(FX_ANXIETY_UNEASY);
    expect(categoryOf('/assets/audio/FX/Anxiety/LV3_TERRIFIED/ANXIETY_TERRIFIED_female_shivering.mp3')).toBe(FX_ANXIETY_TERRIFIED);
    expect(categoryOf('/assets/audio/FX/Anxiety/respiracao_nova.mp3')).toBe(FX_ANXIETY_UNEASY);
    expect(categoryOf('/assets/audio/FX/Hunger/HUNGER_growl1.mp3')).toBe(FX_HUNGER);
    expect(categoryOf('/assets/audio/FX/Hunger/HUNGER_LOW_growl1.mp3')).toBe(FX_HUNGER_LOW);
    expect(categoryOf('/assets/audio/FX/Thirst/THIRST_woman clearing throat1.mp3')).toBe(FX_THIRST);
    expect(categoryOf('/assets/audio/FX/Thirst/THIRST_LOW_woman clearing throat1.mp3')).toBe(FX_THIRST_LOW);
    expect(categoryOf('/assets/audio/FX/Low Health/heartbeat_1.mp3')).toBe(FX_LOW_HEALTH);
    expect(categoryOf('/assets/audio/FX/Getting Hurt/fast_heartbeat (1).mp3')).toBe(FX_HURT);
    expect(categoryOf('/assets/audio/FX/Screams/scream1.mp3')).toBe(FX_SCREAM);
  });

  it('só toca o que está em FX e Music; o resto fica guardado', () => {
    expect(categoryOf('/assets/audio/Memes HYDRA/MAKITA.ogg')).toBeNull();
    expect(categoryOf('/assets/audio/Vozes/qualquer.mp3')).toBeNull();
    expect(categoryOf('/assets/audio/solto.mp3')).toBeNull();
    expect(buildLibrary(collectAudioFiles()).size).toBeGreaterThan(0);
    expect([...buildLibrary(collectAudioFiles()).values()].flat().every((clip) => /^\/assets\/audio\/(FX|Music)\//.test(clip.path))).toBe(true);
  });

  it('ignora caminhos de fora da pasta de áudio', () => {
    expect(categoryOf('/assets/scenes/reception.jpg')).toBeNull();
    expect(categoryOf('/assets/audio/Memes HYDRA/MAKITA.ogg')).toBeNull();
  });

  it('liga cada nível de ansiedade do jogo à pasta correspondente', () => {
    expect(anxietyCategoryFor('calm')).toBe(FX_ANXIETY_CALM);
    expect(anxietyCategoryFor('uneasy')).toBe(FX_ANXIETY_UNEASY);
    expect(anxietyCategoryFor('terrified')).toBe(FX_ANXIETY_TERRIFIED);
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
    // Os três níveis de ansiedade têm arquivos próprios.
    expect(library.get(FX_ANXIETY_CALM)?.length).toBeGreaterThanOrEqual(5);
    expect(library.get(FX_ANXIETY_UNEASY)?.length).toBeGreaterThanOrEqual(4);
    expect(library.get(FX_ANXIETY_TERRIFIED)?.length).toBeGreaterThanOrEqual(5);
  });

  it('toda categoria tem fade de saída e variação de afinação', () => {
    [MUSIC_MENU, MUSIC_LOBBY, FX_SAFE_ROOM, FX_PANIC_ATTACK, FX_HURT, FX_SCREAM, FX_THIRST, FX_HUNGER, FX_LOW_HEALTH].forEach((category) => {
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

describe('vocalizações do personagem', () => {
  const VOCAL = [
    FX_SAFE_ROOM, FX_PANIC_ATTACK, FX_ANXIETY_CALM, FX_ANXIETY_UNEASY, FX_ANXIETY_TERRIFIED,
    FX_HUNGER, FX_HUNGER_LOW, FX_THIRST, FX_THIRST_LOW, FX_SCREAM,
  ];

  it('roteia toda a voz do personagem para o próprio barramento e grupo exclusivo', () => {
    VOCAL.forEach((category) => {
      const config = configFor(category);
      expect(isVoiceCategory(category)).toBe(true);
      expect(config.bus).toBe('voice');
      expect(config.group).toBe(VOICE_GROUP);
    });
    // Batimentos não são vocalização: ficam nos efeitos, em grupo próprio.
    [FX_LOW_HEALTH, FX_HURT].forEach((category) => {
      expect(configFor(category).bus).toBe('fx');
      expect(isVoiceCategory(category)).toBe(false);
    });
    expect(configFor(FX_LOW_HEALTH).group).toBe(configFor(FX_HURT).group);
  });

  it('triplica o espaçamento entre vocalizações', () => {
    expect(VOICE_SPACING_FACTOR).toBe(3);
    // Fome: o ajuste original era 52s-115s com piso de 24s.
    expect(configFor(FX_HUNGER).gapMs).toEqual([52000 * 3, 115000 * 3]);
    expect(configFor(FX_HUNGER).cooldownMs).toBe(24000 * 3);
    expect(configFor(FX_THIRST_LOW).gapMs).toEqual([24000 * 3, 58000 * 3]);
    expect(configFor(FX_SCREAM).cooldownMs).toBe(75000 * 3);
  });

  it('aplica as reduções de volume pedidas para fome e batimentos', () => {
    // Fome: 20% abaixo de 0.66 / 0.76.
    expect(configFor(FX_HUNGER).volume).toBeCloseTo(0.528, 5);
    expect(configFor(FX_HUNGER_LOW).volume).toBeCloseTo(0.608, 5);
    // Batimentos: 15% abaixo de 0.7 / 0.88.
    expect(configFor(FX_LOW_HEALTH).volume).toBeCloseTo(0.595, 5);
    expect(configFor(FX_HURT).volume).toBeCloseTo(0.748, 5);
  });

  it('lê o gênero do personagem no nome do arquivo', () => {
    expect(clipGenderOf('/assets/audio/FX/Anxiety/female_gasp_entering_safe_room1.mp3')).toBe('female');
    expect(clipGenderOf('/assets/audio/FX/Thirst/THIRST_LOW_woman clearing throat1.mp3')).toBe('female');
    expect(clipGenderOf('/assets/audio/FX/Thirst/THIRST_male Clearing Throat1.mp3')).toBe('male');
    expect(clipGenderOf('/assets/audio/FX/Anxiety/male_gasp_entering_safe_room (1).mp3')).toBe('male');
    expect(clipGenderOf('/assets/audio/FX/Hunger/HUNGER_growl1.mp3')).toBe('any');
  });

  it('separa os arquivos de voz por personagem, mantendo os neutros', () => {
    const clips = buildLibrary(collectAudioFiles()).get(FX_THIRST) ?? [];
    expect(clips.length).toBeGreaterThan(0);
    const male = clipsForGender(clips, 'male');
    const female = clipsForGender(clips, 'female');
    expect(male.every((clip) => clip.gender !== 'female')).toBe(true);
    expect(female.every((clip) => clip.gender !== 'male')).toBe(true);
    expect(male.some((clip) => clip.gender === 'male')).toBe(true);
    expect(female.some((clip) => clip.gender === 'female')).toBe(true);
  });

  it('cai na lista inteira quando não há arquivo do gênero escolhido', () => {
    const onlyMale = [{ path: 'male_a.mp3', category: FX_THIRST, rare: false, gender: 'male' as const }];
    expect(clipsForGender(onlyMale, 'female')).toHaveLength(1);
  });
});

describe('ganho por arquivo', () => {
  it('sobe 20% nas lâmpadas do lobby e desce 5% na música do lobby', () => {
    expect(clipGain('/assets/audio/Music/Ambient/LV0_lobby/lobby_lights (1).mp3')).toBeCloseTo(1.2, 5);
    expect(clipGain('/assets/audio/Music/Ambient/LV0_lobby/lobby_song.mp3')).toBeCloseTo(0.95, 5);
    expect(clipGain('/assets/audio/FX/Hunger/HUNGER_growl1.mp3')).toBe(1);
  });
});

describe('biblioteca sem duplicatas', () => {
  it('conta uma vez o mesmo som exportado em mp3 e ogg', () => {
    const library = buildLibrary([
      '/assets/audio/FX/Anxiety/male_gasp_entering_safe_room (1).mp3',
      '/assets/audio/FX/Anxiety/male_gasp_entering_safe_room (1).ogg',
      '/assets/audio/FX/Anxiety/male_gasp_entering_safe_room (2).ogg',
    ]);
    expect(library.get(FX_SAFE_ROOM)).toHaveLength(2);
  });

  it('nenhuma categoria do manifesto real tem o mesmo som duas vezes', () => {
    for (const clips of buildLibrary(collectAudioFiles()).values()) {
      const names = clips.map((clip) => clip.path.replace(/\.[a-z0-9]+$/i, ''));
      expect(new Set(names).size).toBe(names.length);
    }
  });
});
