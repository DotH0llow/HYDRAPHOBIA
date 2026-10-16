import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';

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
