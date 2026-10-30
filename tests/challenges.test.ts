import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { EditorProject } from '../src/editor/EditorProject';
import { connectWire, createWirePanel, OUTPUT_LABELS, wiresSolved } from '../src/systems/wires';
import type { ChallengeDefinition, ItemDefinition, WorldDefinition } from '../src/config/world';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const advance = (game: Game, seconds: number): void => {
  let remaining = seconds;
  while (remaining > 0) {
    const step = Math.min(0.25, remaining);
    game.update(step);
    remaining -= step;
  }
};

const ITEMS: Record<string, ItemDefinition> = {
  medkit: { name: 'Kit', icon: '✚', description: '', useText: 'Tratado.', effect: 'heal', effectAmount: 40, value: 9 },
  lanterna: { name: 'Lanterna', icon: '⌾', description: '', useText: 'Acesa.', effect: 'light', effectAmount: 0, value: 12, batterySeconds: 100 },
};

const PAINEL: ChallengeDefinition = {
  kind: 'wires',
  wirePairs: [{ from: 'A', to: '3' }, { from: 'B', to: '1' }, { from: 'C', to: '5' }],
  shockDamage: 3,
  success: { message: 'As luzes acendem uma a uma.', grantsFlag: 'painelFechado' },
};

const challengeWorld = (challenge: ChallengeDefinition = PAINEL, darkness = 0): WorldDefinition => ({
  startRoomId: 'sala',
  rooms: {
    sala: {
      id: 'sala', name: 'Sala', code: 'A', image: '', description: 'Uma sala.', exits: {},
      darknessLevel: darkness,
      hotspots: [{ id: 'painel', label: 'Painel', x: 0, y: 0, width: 10, height: 10, kind: 'challenge', message: 'Você abre a tampa.', challenge }],
    },
  },
});

const challengeGame = (challenge?: ChallengeDefinition, darkness?: number): Game =>
  new Game(undefined, () => 0.5, challengeWorld(challenge, darkness), undefined, ITEMS, {});

describe('painel de fios', () => {
  it('respeita as ligações escritas no editor', () => {
    const panel = createWirePanel(PAINEL, () => 0.5);
    expect(panel.wires.map((wire) => wire.from)).toEqual(['A', 'B', 'C']);
    expect(panel.solution).toEqual({ A: '3', B: '1', C: '5' });
    // Seis conectores sempre aparecem, mesmo com três fios.
    expect(panel.connectors).toHaveLength(6);
    // A cor é sorteada por painel e não repete entre os fios.
    expect(new Set(panel.wires.map((wire) => wire.color)).size).toBe(3);
  });

  it('sorteia um painel inteiro quando o editor não escreveu as ligações', () => {
    const panel = createWirePanel({ kind: 'wires', wireCount: 5 }, () => 0.5);
    expect(panel.wires).toHaveLength(5);
    expect(new Set(Object.values(panel.solution)).size).toBe(5);
    panel.wires.forEach((wire) => expect(OUTPUT_LABELS).toContain(wire.from as typeof OUTPUT_LABELS[number]));
  });

  it('menos de três ligações escritas não fazem painel: o resto é sorteado', () => {
    const panel = createWirePanel({ kind: 'wires', wirePairs: [{ from: 'A', to: '1' }], wireCount: 4 }, () => 0.5);
    expect(panel.wires.length).toBeGreaterThanOrEqual(3);
    expect(panel.solution.A).toBe('1');
  });

  it('a mesma letra e o mesmo número não são escritos duas vezes', () => {
    const panel = createWirePanel({
      kind: 'wires',
      wirePairs: [{ from: 'A', to: '1' }, { from: 'A', to: '2' }, { from: 'B', to: '1' }, { from: 'C', to: '4' }, { from: 'D', to: '5' }],
    }, () => 0.5);
    expect(panel.solution).toEqual({ A: '1', C: '4', D: '5' });
  });

  it('ligar certo prende o fio e ligar errado devolve a mão vazia', () => {
    const panel = createWirePanel(PAINEL, () => 0.5);
    panel.holding = 'A';
    expect(connectWire(panel, '2')).toBe('shock');
    expect(panel.holding).toBeNull();
    expect(panel.mistakes).toBe(1);
    panel.holding = 'A';
    expect(connectWire(panel, '3')).toBe('linked');
    expect(panel.linked.A).toBe('3');
    // O conector ocupado não aceita um segundo fio.
    panel.holding = 'B';
    expect(connectWire(panel, '3')).toBe('none');
    expect(wiresSolved(panel)).toBe(false);
  });
});

describe('o desafio dentro do jogo', () => {
  it('abre o painel pelo interagível e cobra o choque de cada erro', () => {
    const game = challengeGame();
    expect(game.interact('painel').changed).toBe(true);
    expect(game.status).toBe('challenge');
    expect(game.challenge?.intro).toBeNull();
    const health = game.stats.health;
    game.holdWire('A');
    expect(game.linkWire('2').kind).toBe('shock');
    expect(game.stats.health).toBe(health - 3);
  });

  it('fechar o painel entrega a consequência e devolve o jogo à sala', () => {
    const game = challengeGame();
    game.interact('painel');
    (['A', 'B', 'C'] as const).forEach((letter) => {
      game.holdWire(letter);
      game.linkWire(game.challenge!.wires.solution[letter]!);
    });
    expect(game.status).toBe('exploring');
    expect(game.flags.painelFechado).toBe(true);
    expect(game.message).toBe('As luzes acendem uma a uma.');
  });

  it('a cutscene de abertura corre antes do painel', () => {
    const game = challengeGame({ ...PAINEL, introPath: '/assets/cutscenes/painel.jpg', introMedia: 'image', introSeconds: 2 });
    game.interact('painel');
    expect(game.challenge?.intro?.mediaPath).toBe('/assets/cutscenes/painel.jpg');
    advance(game, 2.5);
    expect(game.challenge?.intro).toBeNull();
    expect(game.status).toBe('challenge');
  });

  it('largar o painel no meio também tem consequência escrita', () => {
    const game = challengeGame({ ...PAINEL, giveUp: { message: 'Você fecha a tampa e finge que não viu.' } });
    game.interact('painel');
    game.giveUpChallenge();
    expect(game.status).toBe('exploring');
    expect(game.message).toBe('Você fecha a tampa e finge que não viu.');
  });
});

describe('ferimento que sangra', () => {
  it('leva vida com o tempo e aperta a ansiedade até ser fechado', () => {
    const game = challengeGame();
    game.debugBleed(30);
    game.debugSetStat('anxiety', 20);
    const health = game.stats.health;
    // Sete segundos: o corte já apertou a ansiedade uma vez e a calma de ficar parado
    // na sala (que cobra de dez em dez segundos) ainda não entrou para compensá-la.
    advance(game, 7);
    expect(game.stats.health).toBeLessThan(health);
    expect(game.stats.anxiety).toBe(21);
    expect(game.bleeding).toBeCloseTo(23, 1);
  });

  it('um item de cura fecha o corte junto com a vida', () => {
    const game = challengeGame();
    game.debugAddItem('medkit');
    game.debugBleed(30);
    const result = game.useItem('medkit');
    expect(game.bleeding).toBe(0);
    expect(result.message).toContain('sangramento');
  });

  it('o corte sobrevive ao registro salvo', () => {
    const game = challengeGame();
    game.debugBleed(18);
    const restored = new Game(game.toSave(), () => 0.5, challengeWorld(), undefined, ITEMS, {});
    expect(restored.bleeding).toBeCloseTo(18, 5);
  });
});

describe('lanterna com pilha', () => {
  it('acende sozinha no escuro, gasta pilha e se apaga na sala clara', () => {
    const dark = challengeGame(PAINEL, 0.8);
    dark.debugAddItem('lanterna');
    advance(dark, 1);
    expect(dark.lanternOn).toBe(true);
    expect(dark.battery).toBeLessThan(1);

    const bright = challengeGame(PAINEL, 0.1);
    bright.debugAddItem('lanterna');
    advance(bright, 1);
    expect(bright.lanternOn).toBe(false);
    expect(bright.battery).toBe(1);
  });

  it('com a pilha vazia ela não acende nem no escuro, e usar o item só diz a carga', () => {
    const game = challengeGame(PAINEL, 0.9);
    game.debugAddItem('lanterna');
    // Cem segundos de pilha, com folga para o zero.
    advance(game, 120);
    expect(game.battery).toBe(0);
    expect(game.lanternOn).toBe(false);
    const result = game.useItem('lanterna');
    // A lanterna não se gasta ao ser usada: ela continua no inventário.
    expect(result.changed).toBe(false);
    expect(game.inventory.some((entry) => entry.id === 'lanterna')).toBe(true);
  });

  it('sem lanterna na mochila não há pilha para mostrar', () => {
    const game = challengeGame(PAINEL, 0.9);
    expect(game.carriesLantern).toBe(false);
    advance(game, 2);
    expect(game.lanternOn).toBe(false);
  });
});

describe('ataques por entidade', () => {
  const world: WorldDefinition = {
    startRoomId: 'sala',
    rooms: {
      sala: {
        id: 'sala', name: 'Sala', code: 'A', image: '', description: '.', exits: {},
        hotspots: [{ id: 'olhar', label: 'Olhar', x: 0, y: 0, width: 5, height: 5, kind: 'event', message: '.', event: 'morde' }],
      },
    },
  };
  const entities = {
    morde: {
      name: 'O que morde', prompt: '.', hint: '.', solution: 'run' as const, timeLimit: 3, image: '',
      attacks: [{ id: 'mordida', name: 'Mordida', damage: 26, effects: ['bleed' as const], bleedSeconds: 40, weight: 1 }],
    },
  };

  it('o golpe da lista manda no dano e deixa o ferimento sangrando', () => {
    const game = new Game(undefined, () => 0.5, world, undefined, ITEMS, entities);
    game.interact('olhar');
    expect(game.status).toBe('encounter');
    // Esconder-se é o erro: a resposta certa era correr.
    const result = game.respondToEncounter('hide');
    expect(result.attack).toBe(true);
    expect(game.stats.health).toBe(74);
    expect(game.bleeding).toBe(40);
    expect(game.lastAttack?.id).toBe('mordida');
    expect(game.message).toContain('sangrar');
  });

  it('o interagível de evento chama a entidade dele mesmo com o medidor de perigo cheio', () => {
    const game = new Game(undefined, () => 0.5, world, undefined, ITEMS, entities);
    game.debugSetDanger(99);
    game.interact('olhar');
    expect(game.encounter?.id).toBe('morde');
    // O medidor fica cheio e cobra depois, em vez de roubar esta cena.
    expect(game.danger).toBe(99);
  });
});

describe('o nível de fábrica não volta sozinho', () => {
  it('um projeto sem as salas de fábrica continua sem elas depois de recarregar', () => {
    const storage = new MemoryStorage();
    const project = new EditorProject(storage);
    const novo = project.addLevel('Mundo Real');
    project.data.levels.filter((level) => level.id !== novo.id).forEach((level) => project.deleteLevel(level.id));
    project.save();
    expect(project.data.levels).toHaveLength(1);

    const reloaded = new EditorProject(storage);
    expect(reloaded.data.levels).toHaveLength(1);
    expect(reloaded.data.levels[0]!.name).toBe('Mundo Real');
    expect(reloaded.data.activeLevelId).toBe(novo.id);
  });
});

describe('desfazer e refazer no editor', () => {
  it('Ctrl+Z volta a última mudança e Ctrl+Shift+Z a traz de volta', () => {
    const project = new EditorProject(null);
    const level = project.activeLevel;
    const before = level.rooms.length;
    // As gravações muito próximas contam como um passo só; aqui elas são separadas à mão.
    project.addRoom();
    project.undo();
    expect(project.activeLevel.rooms).toHaveLength(before);
    expect(project.redo()).toBe(true);
    expect(project.activeLevel.rooms).toHaveLength(before + 1);
  });

  it('sem nada guardado, desfazer não faz nada', () => {
    const project = new EditorProject(null);
    expect(project.canUndo).toBe(false);
    expect(project.undo()).toBe(false);
  });
});

describe('arrastar as outras listas', () => {
  it('muda a ordem dos itens, das entidades e das salas sem mexer no resto', () => {
    const project = new EditorProject(null);
    const items = project.data.items.map((item) => item.id);
    expect(project.moveItem(items[0]!, items[2]!, false)).toBe(true);
    expect(project.data.items.map((item) => item.id)).toEqual([items[1], items[2], items[0], ...items.slice(3)]);

    const entities = project.data.entities.map((entity) => entity.id);
    expect(project.moveEntity(entities[2]!, entities[0]!, true)).toBe(true);
    expect(project.data.entities[0]!.id).toBe(entities[2]);

    // Mover para cima de si mesmo não é mover.
    expect(project.moveItem(items[0]!, items[0]!, true)).toBe(false);
  });
});
