import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import type { WorldDefinition } from '../src/config/world';

const advance = (game: Game, seconds: number): void => {
  let remaining = seconds;
  while (remaining > 0) {
    const step = Math.min(0.25, remaining);
    game.update(step);
    remaining -= step;
  }
};

const simpleWorld = (hotspots: WorldDefinition['rooms']['start']['hotspots'] = []): WorldDefinition => ({
  startRoomId: 'start',
  rooms: {
    start: { id: 'start', name: 'Início', code: 'A', image: '', description: 'Sala inicial.', exits: { forward: { to: 'other', label: 'Avançar' } }, hotspots },
    other: { id: 'other', name: 'Outra', code: 'B', image: '', description: 'Outra sala.', exits: { back: { to: 'start', label: 'Voltar' } }, hotspots: [] },
  },
});

describe('exploração', () => {
  it('navega entre salas conectadas e consome recursos', () => {
    const game = new Game(undefined, () => 1);
    const result = game.navigate('forward');
    expect(result.changed).toBe(true);
    expect(game.position).toBe('mainCorridor');
    expect(game.stats.hunger).toBeLessThan(100);
    expect(game.stats.thirst).toBeLessThan(100);
    expect(game.discovered.has('mainCorridor')).toBe(true);
  });

  it('impede passagem bloqueada até usar o item no cenário', () => {
    const game = new Game(undefined, () => 1);
    game.interact('receptionDrawer');
    game.navigate('forward');
    expect(game.navigate('forward').changed).toBe(false);
    game.selectItem('accessCard');
    expect(game.interact('cardReader').changed).toBe(true);
    expect(game.flags.maintenanceUnlocked).toBe(true);
    expect(game.navigate('forward').changed).toBe(true);
    expect(game.position).toBe('maintenance');
  });

  it('coleta, examina, usa e descarta itens', () => {
    const game = new Game(undefined, () => 1);
    game.navigate('forward');
    game.navigate('right');
    expect(game.interact('waterBottle').pickup).toBe('almondWater');
    game.stats.thirst = 20;
    expect(game.useItem('almondWater').changed).toBe(true);
    expect(game.stats.thirst).toBe(78);
    game.interact('looseFuse');
    expect(game.examineItem('fuse')).toContain('Pesado');
    expect(game.discardItem('fuse').changed).toBe(true);
    expect(game.inventory.some((item) => item.id === 'fuse')).toBe(false);
  });

  it('não permite coletar duas vezes um objeto único', () => {
    const game = new Game(undefined, () => 1);
    game.interact('receptionDrawer');
    game.interact('receptionDrawer');
    expect(game.inventory.find((item) => item.id === 'accessCard')?.quantity).toBe(1);
  });

  it('oferece um percurso completo até a saída', () => {
    const game = new Game(undefined, () => 1);
    game.interact('receptionDrawer');
    game.navigate('forward');
    game.navigate('right');
    game.interact('looseFuse');
    game.navigate('back');
    game.selectItem('accessCard');
    game.interact('cardReader');
    game.navigate('forward');
    game.selectItem('fuse');
    game.interact('breaker');
    const exit = game.navigate('right');
    expect(exit.changed).toBe(true);
    expect(game.position).toBe('threshold');
    expect(game.status).toBe('escaped');
  });
});

describe('sobrevivência e entidades', () => {
  it('reduz fome e sede com delta time e perde vida quando zeradas', () => {
    const game = new Game(undefined, () => 1);
    game.stats.hunger = 0;
    game.stats.thirst = 0;
    game.update(1);
    expect(game.stats.health).toBeLessThan(100);
  });

  it('usa a drenagem de fome e sede reduzida em vinte por cento', () => {
    const game = new Game(undefined, () => 1);
    game.update(.25);
    expect(game.stats.hunger).toBeCloseTo(99.976, 5);
    expect(game.stats.thirst).toBeCloseTo(99.964, 5);
  });

  it('resolve encontro com a decisão coerente', () => {
    const game = new Game(undefined, () => 1);
    game.debugStartEncounter('watcher');
    const result = game.respondToEncounter('hide');
    expect(result.attack).not.toBe(true);
    expect(game.status).toBe('exploring');
    expect(game.stats.health).toBe(100);
  });

  it('ataques reduzem vida e podem causar game over', () => {
    const game = new Game(undefined, () => 1);
    game.stats.health = 34;
    game.debugStartEncounter('crawler');
    const result = game.respondToEncounter('hide');
    expect(result.attack).toBe(true);
    expect(game.stats.health).toBe(0);
    expect(game.status).toBe('gameover');
  });

  it('cheat de invencibilidade impede dano e permite ajustar atributos', () => {
    const game = new Game(undefined, () => 1);
    game.debugSetStat('health', 12);
    game.setInvincible(true);
    game.debugStartEncounter('crawler');
    game.respondToEncounter('hide');
    expect(game.stats.health).toBe(12);
    expect(game.status).toBe('exploring');
    game.debugAddItem('medkit');
    expect(game.inventory).toContainEqual({ id: 'medkit', quantity: 1 });
  });

  it('pausa interrompe a degradação dos recursos', () => {
    const game = new Game(undefined, () => 1);
    game.pause(true);
    game.update(100);
    expect(game.stats.hunger).toBe(100);
    expect(game.elapsed).toBe(0);
  });
});

describe('medidor de perigo', () => {
  it('soma 1 ponto a cada 10s na mesma sala', () => {
    const game = new Game(undefined, () => 1, simpleWorld());
    advance(game, 10);
    expect(game.danger).toBe(1);
    advance(game, 10);
    expect(game.danger).toBe(2);
  });

  it('soma 4 pontos ao sair de uma sala em menos de 5s', () => {
    const game = new Game(undefined, () => 1, simpleWorld());
    advance(game, 2);
    game.navigate('forward');
    expect(game.danger).toBe(4);
  });

  it('não penaliza saída depois de 5s na sala', () => {
    const game = new Game(undefined, () => 1, simpleWorld());
    advance(game, 6);
    game.navigate('forward');
    expect(game.danger).toBe(0);
  });

  it('soma 2 pontos ao examinar e 1 ponto para outras interações', () => {
    const hotspots: WorldDefinition['rooms']['start']['hotspots'] = [
      { id: 'look', label: 'Examinar', x: 0, y: 0, width: 10, height: 10, kind: 'examine', message: 'Nada aqui.' },
      { id: 'touch', label: 'Tocar', x: 0, y: 0, width: 10, height: 10, kind: 'use', message: 'Você toca.' },
    ];
    const game = new Game(undefined, () => 1, simpleWorld(hotspots));
    game.interact('look');
    expect(game.danger).toBe(2);
    game.interact('touch');
    expect(game.danger).toBe(3);
  });
});

describe('ansiedade', () => {
  it('soma 1 ponto a cada 10s de jogo', () => {
    const game = new Game(undefined, () => 1, simpleWorld());
    advance(game, 10);
    expect(game.stats.anxiety).toBe(1);
  });

  it('soma 10 pontos ao iniciar um encontro e 20 ao se machucar', () => {
    const game = new Game(undefined, () => 1, simpleWorld());
    game.debugStartEncounter('watcher');
    expect(game.stats.anxiety).toBe(10);
    game.respondToEncounter('run');
    expect(game.stats.anxiety).toBe(30);
  });

  it('soma 1 ponto a cada 10s com algum atributo crítico', () => {
    const game = new Game(undefined, () => 1, simpleWorld());
    game.debugSetStat('thirst', 10);
    advance(game, 10);
    expect(game.stats.anxiety).toBe(2);
  });
});

describe('visibilidade de hotspots', () => {
  it('hotspot escondido só existe nas flags após o tempo acumulado na sala', () => {
    const hotspot: WorldDefinition['rooms']['start']['hotspots'][number] = { id: 'secret', label: 'Oculto', x: 0, y: 0, width: 10, height: 10, kind: 'examine', message: 'Achou.', visibility: 'hidden', revealSeconds: 20 };
    const game = new Game(undefined, () => 1, simpleWorld([hotspot]));
    advance(game, 10);
    expect(game.flags['reveal:start:secret']).toBeUndefined();
    advance(game, 10);
    expect(game.flags['reveal:start:secret']).toBe(true);
  });

  it('o tempo na sala acumula entre visitas separadas', () => {
    const hotspot: WorldDefinition['rooms']['start']['hotspots'][number] = { id: 'secret', label: 'Oculto', x: 0, y: 0, width: 10, height: 10, kind: 'examine', message: 'Achou.', visibility: 'hidden', revealSeconds: 15 };
    const game = new Game(undefined, () => 1, simpleWorld([hotspot]));
    advance(game, 10);
    game.navigate('forward');
    game.navigate('back');
    expect(game.flags['reveal:start:secret']).toBeUndefined();
    advance(game, 5);
    expect(game.flags['reveal:start:secret']).toBe(true);
  });

  it('hotspot invisível é revelado ao ser clicado', () => {
    const hotspot: WorldDefinition['rooms']['start']['hotspots'][number] = { id: 'ghost', label: 'Fantasma', x: 0, y: 0, width: 10, height: 10, kind: 'examine', message: 'Achou.', visibility: 'invisible' };
    const game = new Game(undefined, () => 1, simpleWorld([hotspot]));
    expect(game.flags['reveal:start:ghost']).toBeUndefined();
    game.interact('ghost');
    expect(game.flags['reveal:start:ghost']).toBe(true);
  });
});

describe('itens e entidades customizados', () => {
  it('usa definições de itens e entidades fornecidas ao Game', () => {
    const items = { potion: { name: 'Poção', icon: '?', description: 'Um frasco.', useText: 'Bebido.', effect: 'heal' as const, effectAmount: 40 } };
    const entities = { ghoul: { name: 'Carniçal', prompt: 'Algo surge.', hint: 'Fuja.', solution: 'run' as const, timeLimit: 3, image: '/x.jpg' } };
    const game = new Game(undefined, () => 1, simpleWorld(), undefined, items, entities);
    game.debugAddItem('potion');
    game.stats.health = 50;
    const result = game.useItem('potion');
    expect(result.changed).toBe(true);
    expect(game.stats.health).toBe(90);
    game.debugStartEncounter('ghoul');
    expect(game.encounter?.name).toBe('Carniçal');
    expect(game.encounter?.timeLimit).toBe(3);
  });
});

describe('cheat de vida e invencibilidade', () => {
  it('zerar a vida via cheat mata o personagem mesmo com invencibilidade ligada', () => {
    const game = new Game(undefined, () => 1);
    game.setInvincible(true);
    game.debugSetStat('health', 0);
    expect(game.status).toBe('gameover');
    game.setInvincible(false);
    expect(game.status).toBe('gameover');
  });

  it('restaurar vida acima de zero reanima o personagem', () => {
    const game = new Game(undefined, () => 1);
    game.debugSetStat('health', 0);
    expect(game.status).toBe('gameover');
    game.debugSetStat('health', 50);
    expect(game.status).toBe('exploring');
  });
});

describe('ansiedade por dano sem entidade', () => {
  it('soma 10 pontos uma vez ao começar a sofrer dano de fome/sede críticas', () => {
    const game = new Game(undefined, () => 1, simpleWorld());
    game.debugSetStat('hunger', 0);
    advance(game, 0.25);
    expect(game.stats.anxiety).toBe(10);
    advance(game, 0.25);
    expect(game.stats.anxiety).toBe(10);
  });
});

describe('medidor de perigo no máximo', () => {
  it('ao chegar em 100 dispara um encontro sem causar dano automático', () => {
    const hotspots: WorldDefinition['rooms']['start']['hotspots'] = [
      { id: 'look', label: 'Examinar', x: 0, y: 0, width: 10, height: 10, kind: 'examine', message: 'Nada aqui.' },
    ];
    const game = new Game(undefined, () => 1, simpleWorld(hotspots));
    for (let index = 0; index < 50; index += 1) game.interact('look');
    expect(game.danger).toBeLessThan(100);
    expect(game.status).toBe('encounter');
    expect(game.stats.health).toBe(100);
  });
});

describe('cutscenes', () => {
  it('cutscene de imagem bloqueia exploração e termina após a duração', () => {
    const hotspot: WorldDefinition['rooms']['start']['hotspots'][number] = { id: 'photo', label: 'Foto', x: 0, y: 0, width: 10, height: 10, kind: 'cutscene', message: 'Uma lembrança.', cutsceneMedia: 'image', cutscenePath: '/x.jpg', cutsceneHoldSeconds: 1 };
    const game = new Game(undefined, () => 1, simpleWorld([hotspot]));
    game.interact('photo');
    expect(game.status).toBe('cutscene');
    expect(game.navigate('forward').changed).toBe(false);
    advance(game, 1);
    expect(game.status).toBe('exploring');
    expect(game.cutscene).toBeNull();
  });

  it('cutscene em vídeo só avança por loop externo, não por tempo', () => {
    const hotspot: WorldDefinition['rooms']['start']['hotspots'][number] = { id: 'clip', label: 'Clipe', x: 0, y: 0, width: 10, height: 10, kind: 'cutscene', message: 'Um vídeo.', cutsceneMedia: 'video', cutscenePath: '/x.mp4', cutsceneRepeatCount: 2 };
    const game = new Game(undefined, () => 1, simpleWorld([hotspot]));
    game.interact('clip');
    advance(game, 5);
    expect(game.status).toBe('cutscene');
    game.advanceCutsceneLoop();
    expect(game.status).toBe('cutscene');
    game.advanceCutsceneLoop();
    expect(game.status).toBe('exploring');
  });
});
