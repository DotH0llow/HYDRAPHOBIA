import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { EditorProject } from '../src/editor/EditorProject';
import { npcsToRuntime } from '../src/editor/mapAdapter';
import { buyPrice, moodLabel, sellPrice, startingReputation, TENSE_ANXIETY } from '../src/systems/npc';
import type { ItemDefinition, NpcDefinition, WorldDefinition } from '../src/config/world';

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
  pao: { name: 'Pão', icon: '▰', description: '', useText: '', effect: 'feed', effectAmount: 10, value: 4 },
  faca: { name: 'Faca', icon: '†', description: '', useText: '', effect: 'none', effectAmount: 0, value: 10 },
};

const VENDOR: NpcDefinition = {
  name: 'O homem do carrinho',
  personality: 'cordial',
  reputation: 50,
  trades: true,
  stock: [{ id: 'faca', quantity: 1 }],
  lines: [
    { id: 'abre', text: 'Você tem cara de quem precisa de alguma coisa.', answers: [
      { id: 'trocar', text: 'Vamos ver o que você tem.', opensTrade: true },
      { id: 'sair', text: 'Nada, obrigado.' },
      { id: 'elogio', text: 'Você é o primeiro rosto em dias.', to: 'segue', reputation: 6 },
    ] },
    { id: 'segue', text: 'Rosto é o que menos falta aqui.', answers: [] },
  ],
};

const worldWithNpc = (): WorldDefinition => ({
  startRoomId: 'sala',
  npcs: { vendedor: VENDOR },
  rooms: {
    sala: {
      id: 'sala', name: 'Sala', code: 'A', image: '', description: 'Uma sala.',
      exits: {},
      npcs: [{ npcId: 'vendedor', x: 50, y: 60, height: 40 }],
      hotspots: [
        { id: 'falar', label: 'Falar', x: 0, y: 0, width: 10, height: 10, kind: 'npc', message: '', npc: 'vendedor' },
      ],
    },
  },
});

const vendorGame = (): Game => new Game(undefined, () => 0.5, worldWithNpc(), undefined, ITEMS, {}, { vendedor: VENDOR });

describe('economia dos vendedores', () => {
  it('a reputação decide o preço, e a personalidade decide a reputação', () => {
    expect(startingReputation({ ...VENDOR, reputation: undefined, personality: 'acolhedor' })).toBe(75);
    expect(startingReputation({ ...VENDOR, reputation: undefined, personality: 'hostil' })).toBe(12);
    // Quem não gosta de você cobra mais caro e paga menos pelo mesmo item.
    expect(buyPrice(10, 0)).toBeGreaterThan(buyPrice(10, 100));
    expect(sellPrice(10, 100)).toBeGreaterThan(sellPrice(10, 0));
    expect(buyPrice(10, 50)).toBe(10);
  });

  it('acima de 60 de ansiedade todo item custa 1 a mais', () => {
    expect(buyPrice(10, 50, TENSE_ANXIETY - 1)).toBe(10);
    expect(buyPrice(10, 50, TENSE_ANXIETY)).toBe(11);
    expect(buyPrice(10, 50, 100)).toBe(11);
  });

  it('o preço nunca desce a zero, nem com a reputação cheia', () => {
    expect(buyPrice(0, 100)).toBe(1);
    expect(sellPrice(1, 0)).toBe(1);
    expect(moodLabel(95)).not.toBe(moodLabel(5));
  });
});

describe('conversa com um NPC', () => {
  it('clicar no interagível abre a conversa e guarda a primeira fala no histórico', () => {
    const game = vendorGame();
    expect(game.interact('falar').changed).toBe(true);
    expect(game.status).toBe('dialogue');
    expect(game.dialogueLine?.id).toBe('abre');
    expect(game.dialogueLog).toHaveLength(1);
    expect(game.dialogueLog[0]!.side).toBe('npc');
    expect(game.npcMemory('vendedor').met).toBe(true);
  });

  it('a resposta leva à fala seguinte e mexe na reputação', () => {
    const game = vendorGame();
    game.interact('falar');
    const before = game.npcMemory('vendedor').reputation;
    game.answerDialogue('elogio');
    expect(game.dialogueLine?.id).toBe('segue');
    expect(game.npcMemory('vendedor').reputation).toBe(before + 6);
    // Fala do NPC, resposta do jogador, fala do NPC.
    expect(game.dialogueLog.map((entry) => entry.side)).toEqual(['npc', 'player', 'npc']);
  });

  it('uma resposta sem destino encerra a conversa', () => {
    const game = vendorGame();
    game.interact('falar');
    game.answerDialogue('sair');
    expect(game.dialogue).toBeNull();
    expect(game.status).toBe('exploring');
  });

  it('conversar protege o jogador, e a proteção sobrevive cinco segundos à conversa', () => {
    const game = vendorGame();
    game.interact('falar');
    expect(game.shielded).toBe(true);
    game.endDialogue();
    expect(game.shielded).toBe(true);
    advance(game, 4.5);
    expect(game.shielded).toBe(true);
    advance(game, 1);
    expect(game.shielded).toBe(false);
  });
});

describe('troca sem moeda', () => {
  it('recusa a troca enquanto o que se oferece não alcança o que se pede', () => {
    const game = vendorGame();
    game.debugAddItem('pao');
    game.interact('falar');
    game.answerDialogue('trocar');
    expect(game.dialogue?.trading).toBe(true);
    game.adjustTrade('ask', 'faca', 1);
    game.adjustTrade('offer', 'pao', 1);
    // A faca vale 10 e o pão 4: um pão não compra uma faca.
    expect(game.tradeTotals.offer).toBeLessThan(game.tradeTotals.ask);
    expect(game.confirmTrade().changed).toBe(false);
    expect(game.inventory.some((entry) => entry.id === 'faca')).toBe(false);
  });

  it('fecha a troca quando o valor alcança, e o estoque troca de mão', () => {
    const game = vendorGame();
    for (let count = 0; count < 6; count += 1) game.debugAddItem('pao');
    game.interact('falar');
    game.openTrade();
    game.adjustTrade('ask', 'faca', 1);
    game.adjustTrade('offer', 'pao', 6);
    const reputation = game.npcMemory('vendedor').reputation;
    expect(game.confirmTrade().changed).toBe(true);
    expect(game.inventory.find((entry) => entry.id === 'faca')?.quantity).toBe(1);
    expect(game.npcMemory('vendedor').stock.some((entry) => entry.id === 'faca')).toBe(false);
    expect(game.npcMemory('vendedor').stock.find((entry) => entry.id === 'pao')?.quantity).toBe(6);
    // Quem paga a mais é lembrado.
    expect(game.npcMemory('vendedor').reputation).toBeGreaterThan(reputation);
  });

  it('não é possível pedir mais do que o vendedor tem', () => {
    const game = vendorGame();
    game.interact('falar');
    game.openTrade();
    game.adjustTrade('ask', 'faca', 5);
    expect(game.dialogue?.ask.find((entry) => entry.id === 'faca')?.quantity).toBe(1);
  });

  it('a reputação e o estoque de cada NPC voltam com o registro salvo', () => {
    const game = vendorGame();
    game.interact('falar');
    game.answerDialogue('elogio');
    const saved = game.toSave();
    const restored = new Game(saved, () => 0.5, worldWithNpc(), undefined, ITEMS, {}, { vendedor: VENDOR });
    expect(restored.npcMemory('vendedor').reputation).toBe(game.npcMemory('vendedor').reputation);
    expect(restored.dialogueLog).toHaveLength(3);
    // A folga da conversa não atravessa o fechar do jogo.
    expect(restored.shielded).toBe(false);
  });
});

describe('pessoas no editor', () => {
  it('a pessoa apagada sai das cenas e dos interagíveis que chamavam por ela', () => {
    const storage = new MemoryStorage();
    const project = new EditorProject(storage);
    const npc = project.addNpc();
    const room = project.activeLevel.rooms[0]!;
    project.addRoomNpc(room.id, npc.id);
    const hotspot = project.addHotspot(room.id)!;
    hotspot.action = 'npc';
    hotspot.npcId = npc.id;
    project.save();
    expect(project.findRoom(room.id)!.npcs).toHaveLength(1);

    project.deleteNpc(npc.id);
    expect(project.findNpc(npc.id)).toBeUndefined();
    expect(project.findRoom(room.id)!.npcs).toHaveLength(0);
    expect(project.findRoom(room.id)!.hotspots.find((entry) => entry.id === hotspot.id)!.npcId).toBeUndefined();
  });

  it('uma resposta que aponta para uma fala apagada passa a encerrar a conversa', () => {
    const storage = new MemoryStorage();
    const project = new EditorProject(storage);
    const npc = project.addNpc();
    const second = project.addNpcLine(npc.id)!;
    const answer = project.addNpcAnswer(npc.id, npc.lines[0]!.id)!;
    answer.to = second.id;
    project.save();
    project.deleteNpcLine(npc.id, second.id);
    expect(project.findNpc(npc.id)!.lines[0]!.answers[0]!.to).toBe('');
  });

  it('o balão não aceita mais de três respostas por fala', () => {
    const project = new EditorProject(null);
    const npc = project.addNpc();
    const line = npc.lines[0]!.id;
    expect(project.addNpcAnswer(npc.id, line)).not.toBeNull();
    expect(project.addNpcAnswer(npc.id, line)).not.toBeNull();
    expect(project.addNpcAnswer(npc.id, line)).not.toBeNull();
    expect(project.addNpcAnswer(npc.id, line)).toBeNull();
  });

  it('o que o editor escreve chega ao jogo como definição de NPC', () => {
    const project = new EditorProject(null);
    const npc = project.addNpc();
    npc.name = 'Vendedora';
    npc.art = '';
    project.setNpcStock(npc.id, 'medkit', 2);
    const runtime = npcsToRuntime(project.data.npcs);
    expect(runtime[npc.id]!.name).toBe('Vendedora');
    // Arte vazia não vira caminho vazio: ela simplesmente não existe, e o jogo desenha o boneco.
    expect(runtime[npc.id]!.art).toBeUndefined();
    expect(runtime[npc.id]!.stock).toEqual([{ id: 'medkit', quantity: 2 }]);
  });
});
