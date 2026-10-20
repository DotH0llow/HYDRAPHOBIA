import type { CharacterClassId, CharacterGender, CharacterProfile, ItemId, PhobiaId } from '../types';

export interface CharacterOption<Id extends string> {
  id: Id;
  label: string;
  description: string;
  icon: string;
  /** Arte da opção. A tela só troca para o modo ilustrado quando todas as opções têm uma. */
  image?: string;
}

/** Pasta das artes de criação de personagem. */
const ART = '/assets/characters';

/** A grade ilustrada é tudo ou nada: um card sem arte no meio dos outros fica torto. */
export const allIllustrated = (options: ReadonlyArray<CharacterOption<string>>): boolean =>
  options.length > 0 && options.every((option) => Boolean(option.image));

export const GENDERS: ReadonlyArray<CharacterOption<CharacterGender>> = [
  { id: 'male', label: 'Masculino', description: 'A voz e as reações do personagem são masculinas.', icon: '♂', image: `${ART}/masculino.webp` },
  { id: 'female', label: 'Feminino', description: 'A voz e as reações do personagem são femininas.', icon: '♀', image: `${ART}/feminino.webp` },
];

export const CLASSES: ReadonlyArray<CharacterOption<CharacterClassId>> = [
  { id: 'explorador', label: 'Explorador', description: 'Conhece corredores vazios melhor do que ruas cheias.', icon: '◈', image: `${ART}/explorador.webp` },
  { id: 'tecnico', label: 'Técnico', description: 'Entende painéis, fusíveis e o que não deveria estar ligado.', icon: '⌁', image: `${ART}/tecnico.webp` },
  { id: 'adolescente', label: 'Adolescente', description: 'Chegou aqui sem querer e ainda não aceitou isso.', icon: '✦', image: `${ART}/adolescente.webp` },
  { id: 'cavaleiro', label: 'Cavaleiro', description: 'Veste uma armadura que ninguém sabe explicar.', icon: '✚', image: `${ART}/cavaleiro.webp` },
];

export const PHOBIAS: ReadonlyArray<CharacterOption<PhobiaId>> = [
  // As artes das fobias ainda estão incompletas; a grade só fica ilustrada com as doze.
  { id: 'nictofobia', label: 'Nictofobia', description: 'Medo do escuro.', icon: '◗', image: `${ART}/nictofobia.webp` },
  { id: 'claustrofobia', label: 'Claustrofobia', description: 'Medo de espaços fechados.', icon: '▣', image: `${ART}/claustrofobia.webp` },
  { id: 'hemofobia', label: 'Hemofobia', description: 'Medo de sangue e ferimentos.', icon: '✛' },
  { id: 'monofobia', label: 'Monofobia', description: 'Medo de ficar sozinho.', icon: '◯' },
  { id: 'talassofobia', label: 'Talassofobia', description: 'Medo de águas profundas.', icon: '≈' },
  { id: 'escopofobia', label: 'Escopofobia', description: 'Medo de ser observado.', icon: '◉' },
  { id: 'automatonofobia', label: 'Automatonofobia', description: 'Medo de bonecos e figuras humanas.', icon: '⚇' },
  { id: 'necrofobia', label: 'Necrofobia', description: 'Medo de cadáveres.', icon: '✝' },
  { id: 'fonofobia', label: 'Fonofobia', description: 'Medo de sons altos e repentinos.', icon: '◁' },
  { id: 'mecanofobia', label: 'Mecanofobia', description: 'Medo de máquinas em funcionamento.', icon: '⚙' },
  { id: 'tanatofobia', label: 'Tanatofobia', description: 'Medo da própria morte.', icon: '⌛' },
  { id: 'apeirofobia', label: 'Apeirofobia', description: 'Medo do infinito e do que não acaba.', icon: '∞' },
];

/** As quatro opções de item inicial oferecidas na criação do personagem. */
export const STARTING_ITEMS: readonly ItemId[] = ['almondWater', 'ration', 'medkit', 'accessCard'];

export const DEFAULT_CHARACTER: CharacterProfile = {
  name: 'Sem nome',
  gender: 'male',
  classId: 'explorador',
  phobia: 'nictofobia',
  startingItem: 'almondWater',
};

export const MAX_CHARACTER_NAME = 18;

const ids = <Id extends string>(options: ReadonlyArray<CharacterOption<Id>>): Set<string> => new Set(options.map((option) => option.id));

const GENDER_IDS = ids(GENDERS);
const CLASS_IDS = ids(CLASSES);
const PHOBIA_IDS = ids(PHOBIAS);

export const labelOf = <Id extends string>(options: ReadonlyArray<CharacterOption<Id>>, id: Id): string =>
  options.find((option) => option.id === id)?.label ?? String(id);

/** Nome digitado pelo jogador, sem caracteres de marcação e dentro do limite. */
export const sanitizeCharacterName = (value: string): string =>
  value.replace(/[<>&"']/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARACTER_NAME);

export const validateCharacter = (value: unknown): CharacterProfile => {
  if (!value || typeof value !== 'object') return { ...DEFAULT_CHARACTER };
  const raw = value as Partial<CharacterProfile>;
  const name = sanitizeCharacterName(String(raw.name ?? ''));
  return {
    name: name || DEFAULT_CHARACTER.name,
    gender: GENDER_IDS.has(String(raw.gender)) ? raw.gender as CharacterGender : DEFAULT_CHARACTER.gender,
    classId: CLASS_IDS.has(String(raw.classId)) ? raw.classId as CharacterClassId : DEFAULT_CHARACTER.classId,
    phobia: PHOBIA_IDS.has(String(raw.phobia)) ? raw.phobia as PhobiaId : DEFAULT_CHARACTER.phobia,
    startingItem: typeof raw.startingItem === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(raw.startingItem) ? raw.startingItem : DEFAULT_CHARACTER.startingItem,
  };
};
