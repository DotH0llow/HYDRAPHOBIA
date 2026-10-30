import { NPC_PERSONALITIES, type NpcDefinition, type NpcPersonality } from '../config/world';
import type { ItemId, NpcMemory } from '../types';

/**
 * A economia do jogo não tem moeda. Cada item carrega um valor, e toda troca é esse
 * valor contra esse valor: o que o jogador oferece precisa somar o que o vendedor
 * pede. O humor do vendedor entra como um multiplicador — ele cobra mais caro de
 * quem não gosta e paga melhor a quem já ajudou.
 */

/** Acima disto o jogador chega visivelmente mal, e o vendedor cobra a diferença. */
export const TENSE_ANXIETY = 60;

/** O acréscimo que o desespero custa, por item. */
export const PANIC_SURCHARGE = 1;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export const reputationFor = (personality: NpcPersonality): number =>
  NPC_PERSONALITIES.find((entry) => entry.id === personality)?.reputation ?? 55;

/** A reputação inicial deste NPC: a dele, se foi escrita, ou a da personalidade. */
export const startingReputation = (npc: NpcDefinition): number =>
  typeof npc.reputation === 'number' ? Math.max(0, Math.min(100, npc.reputation)) : reputationFor(npc.personality);

/**
 * Quanto o vendedor cobra por um item. Com reputação zero ele cobra um terço a mais;
 * na metade da escala o preço é o valor de tabela; com reputação cheia ele cobra dois
 * terços. O preço nunca desce abaixo de 1: nada no jogo é de graça, por melhor que
 * seja a relação.
 */
export const buyPrice = (value: number, reputation: number, anxiety = 0): number => {
  const markup = 1.35 - clamp01(reputation / 100) * 0.7;
  const base = Math.max(1, Math.round(Math.max(0, value) * markup));
  return base + (anxiety >= TENSE_ANXIETY ? PANIC_SURCHARGE : 0);
};

/** Quanto ele paga pelo que o jogador traz: de pouco mais de um terço a quase tudo. */
export const sellPrice = (value: number, reputation: number): number => {
  const offer = 0.35 + clamp01(reputation / 100) * 0.5;
  return Math.max(1, Math.floor(Math.max(0, value) * offer));
};

/** A reputação anda devagar e nunca sai de 0–100. */
export const shiftReputation = (memory: NpcMemory, amount: number): void => {
  memory.reputation = Math.max(0, Math.min(100, memory.reputation + amount));
};

/** Como o vendedor descreve a própria vontade de negociar, pela reputação. */
export const moodLabel = (reputation: number): string => {
  if (reputation >= 78) return 'Confia em você';
  if (reputation >= 56) return 'Cordial';
  if (reputation >= 34) return 'Reservado';
  if (reputation >= 16) return 'Desconfiado';
  return 'Mal tolera você';
};

/** Uma troca fechada deixa o vendedor um pouco mais perto de quem fechou com ele. */
export const TRADE_REPUTATION_GAIN = 2;

export const stockQuantity = (memory: NpcMemory, id: ItemId): number =>
  memory.stock.find((entry) => entry.id === id)?.quantity ?? 0;

export const takeFromStock = (memory: NpcMemory, id: ItemId, quantity = 1): void => {
  const entry = memory.stock.find((item) => item.id === id);
  if (!entry) return;
  entry.quantity -= quantity;
  if (entry.quantity <= 0) memory.stock = memory.stock.filter((item) => item.id !== id);
};

export const addToStock = (memory: NpcMemory, id: ItemId, quantity = 1): void => {
  const entry = memory.stock.find((item) => item.id === id);
  if (entry) entry.quantity += quantity;
  else memory.stock.push({ id, quantity });
};

/**
 * O boneco de teste. Ele existe para que uma cena possa ser montada com gente dentro
 * antes de a arte de verdade existir: é um manequim de madeira, articulado, sem rosto
 * — o que já diz bastante em um jogo destes. A proporção é 100×260 para que a altura
 * em % da cena baste para posicioná-lo.
 */
export const NPC_DUMMY_ART = `<svg class="npc-dummy" viewBox="0 0 100 260" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="npc-wood" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#b79a6d" /><stop offset=".48" stop-color="#8d7247" /><stop offset="1" stop-color="#4a3a22" />
    </linearGradient>
    <radialGradient id="npc-joint" cx=".35" cy=".3" r=".8">
      <stop offset="0" stop-color="#d8c197" /><stop offset="1" stop-color="#5b4729" />
    </radialGradient>
    <filter id="npc-grain" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" result="n" />
      <feColorMatrix in="n" type="saturate" values="0" result="g" />
      <feComposite in="g" in2="SourceAlpha" operator="in" result="t" />
      <feBlend in="SourceGraphic" in2="t" mode="multiply" />
    </filter>
  </defs>
  <ellipse class="npc-dummy-shadow" cx="50" cy="253" rx="31" ry="6" />
  <g filter="url(#npc-grain)" fill="url(#npc-wood)" stroke="#2b2114" stroke-width="1.2">
    <ellipse cx="50" cy="26" rx="17" ry="21" />
    <rect x="45" y="46" width="10" height="11" rx="4" />
    <path d="M30 60 q20 -8 40 0 l4 46 q-24 9 -48 0 z" />
    <circle cx="50" cy="112" r="7.5" fill="url(#npc-joint)" />
    <path d="M33 118 q17 -7 34 0 l3 26 q-20 7 -40 0 z" />
    <rect x="22" y="62" width="11" height="40" rx="5.5" transform="rotate(7 27 82)" />
    <rect x="67" y="62" width="11" height="40" rx="5.5" transform="rotate(-7 73 82)" />
    <circle cx="25" cy="104" r="5.5" fill="url(#npc-joint)" /><circle cx="75" cy="104" r="5.5" fill="url(#npc-joint)" />
    <rect x="19" y="106" width="10" height="38" rx="5" transform="rotate(4 24 125)" />
    <rect x="71" y="106" width="10" height="38" rx="5" transform="rotate(-4 76 125)" />
    <rect x="35" y="148" width="13" height="48" rx="6.5" />
    <rect x="52" y="148" width="13" height="48" rx="6.5" />
    <circle cx="41.5" cy="198" r="6" fill="url(#npc-joint)" /><circle cx="58.5" cy="198" r="6" fill="url(#npc-joint)" />
    <rect x="35" y="200" width="13" height="46" rx="6.5" />
    <rect x="52" y="200" width="13" height="46" rx="6.5" />
    <path d="M32 246 h18 l2 8 h-22 z" /><path d="M50 246 h18 l2 8 h-22 z" />
  </g>
</svg>`;
