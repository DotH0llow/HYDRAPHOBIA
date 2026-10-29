import type { CharacterClassId, CharacterGender, CharacterMode, CharacterProfile, ItemId, PhobiaId } from '../types';

export interface CharacterOption<Id extends string> {
  id: Id;
  label: string;
  description: string;
  icon: string;
  /** Arte da opção. A tela só troca para o modo ilustrado quando todas as opções têm uma. */
  image?: string;
  /** Nome da opção no feminino, quando ele existe. Sem isto o nome serve aos dois. */
  femaleLabel?: string;
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

/**
 * As quatro classes. A descrição é vazia de propósito: a tela de classes mostra só a
 * arte e o nome, em letra grande, sem nenhuma linha de explicação por baixo.
 */
export const CLASSES: ReadonlyArray<CharacterOption<CharacterClassId>> = [
  { id: 'explorador', label: 'Explorador', femaleLabel: 'Exploradora', description: '', icon: '◈', image: `${ART}/explorador.webp` },
  { id: 'tecnico', label: 'Técnico', femaleLabel: 'Técnica', description: '', icon: '⌁', image: `${ART}/tecnico.webp` },
  { id: 'adolescente', label: 'Adolescente', description: '', icon: '✦', image: `${ART}/adolescente.webp` },
  { id: 'cavaleiro', label: 'Cavaleiro', femaleLabel: 'Cavaleira', description: '', icon: '⛉', image: `${ART}/cavaleiro.webp` },
];

/**
 * Arte feminina de cada classe, usada quando o jogador escolhe "Feminino".
 * Uma classe sem arquivo aqui cai de volta na arte comum da classe, para a tela
 * nunca ficar com um card vazio no meio dos outros.
 */
const FEMALE_CLASS_ART: Readonly<Partial<Record<CharacterClassId, string>>> = {
  explorador: `${ART}/explorador_feminino.webp`,
  tecnico: `${ART}/tecnico_feminino.webp`,
  adolescente: `${ART}/adolescente_feminino.webp`,
  cavaleiro: `${ART}/cavaleiro_feminino.webp`,
};

/**
 * O personagem encostado na parede no encontro da caixa torácica: assustado, com as
 * duas mãos tapando a boca. São oito artes, uma por classe e gênero, e quem aparece
 * ali é sempre o personagem que o jogador criou — é ele que está vendo aquilo.
 * São as mesmas artes de classe, no mesmo contraluz, só que nessa pose: por isso
 * ficam em `.webp` ao lado delas, e não num formato à parte.
 */
export const scaredArtFor = (classId: CharacterClassId, gender: CharacterGender): string =>
  `${ART}/scared/${classId}_${gender}.webp`;

/** Arte da classe para o gênero escolhido. */
export const classArtFor = (classId: CharacterClassId, gender: CharacterGender): string | undefined => {
  const base = CLASSES.find((option) => option.id === classId)?.image;
  return gender === 'female' ? FEMALE_CLASS_ART[classId] ?? base : base;
};

/**
 * Nome da classe no gênero do personagem: "Exploradora" no lugar de "Explorador".
 * Classes de nome comum aos dois — adolescente — ficam como estão.
 */
export const classLabelFor = (classId: CharacterClassId, gender: CharacterGender): string => {
  const option = CLASSES.find((entry) => entry.id === classId);
  if (!option) return String(classId);
  return gender === 'female' ? option.femaleLabel ?? option.label : option.label;
};

/** O último passo da criação: com interface ou sem nenhuma. */
export const MODES: ReadonlyArray<CharacterOption<CharacterMode>> = [
  { id: 'classic', label: 'Modo clássico', description: 'Barras, legendas e inventário à vista, como em um registro anotado.', icon: '▤' },
  { id: 'immersive', label: 'Modo imersivo', description: 'Nenhuma interface sobre a cena: só o lugar, o que há nele e você.', icon: '◌' },
];

export const PHOBIAS: ReadonlyArray<CharacterOption<PhobiaId>> = [
  { id: 'nictofobia', label: 'Nictofobia', description: 'Medo do escuro.', icon: '◗', image: `${ART}/nictofobia.webp` },
  { id: 'claustrofobia', label: 'Claustrofobia', description: 'Medo de espaços fechados.', icon: '▣', image: `${ART}/claustrofobia.webp` },
  { id: 'hemofobia', label: 'Hemofobia', description: 'Medo de sangue e ferimentos.', icon: '✛', image: `${ART}/hemofobia.webp` },
  { id: 'monofobia', label: 'Monofobia', description: 'Medo de ficar sozinho.', icon: '◯', image: `${ART}/monofobia.webp` },
  { id: 'talassofobia', label: 'Talassofobia', description: 'Medo de águas profundas.', icon: '≈', image: `${ART}/talassofobia.webp` },
  { id: 'escopofobia', label: 'Escopofobia', description: 'Medo de ser observado.', icon: '◉', image: `${ART}/escopofobia.webp` },
  { id: 'automatonofobia', label: 'Automatonofobia', description: 'Medo de bonecos e figuras humanas.', icon: '⚇', image: `${ART}/automatonofobia.webp` },
  { id: 'necrofobia', label: 'Necrofobia', description: 'Medo de cadáveres.', icon: '✝', image: `${ART}/necrofobia.webp` },
  { id: 'fonofobia', label: 'Fonofobia', description: 'Medo de sons altos e repentinos.', icon: '◁', image: `${ART}/fonofobia.webp` },
  { id: 'mecanofobia', label: 'Mecanofobia', description: 'Medo de máquinas em funcionamento.', icon: '⚙', image: `${ART}/mecanofobia.webp` },
  { id: 'tanatofobia', label: 'Tanatofobia', description: 'Medo da própria morte.', icon: '⌛', image: `${ART}/tanatofobia.webp` },
  { id: 'apeirofobia', label: 'Apeirofobia', description: 'Medo do infinito e do que não acaba.', icon: '∞', image: `${ART}/apeirofobia.webp` },
];

/** As quatro opções de item inicial oferecidas na criação do personagem. */
export const STARTING_ITEMS: readonly ItemId[] = ['almondWater', 'ration', 'medkit', 'accessCard'];

export const DEFAULT_CHARACTER: CharacterProfile = {
  name: 'Sem nome',
  gender: 'male',
  classId: 'explorador',
  phobia: 'nictofobia',
  startingItem: 'almondWater',
  mode: 'classic',
};

export const MAX_CHARACTER_NAME = 26;
/** Nome curto demais não passa da criação. */
export const MIN_CHARACTER_NAME = 3;

const ids = <Id extends string>(options: ReadonlyArray<CharacterOption<Id>>): Set<string> => new Set(options.map((option) => option.id));

const GENDER_IDS = ids(GENDERS);
const CLASS_IDS = ids(CLASSES);
const PHOBIA_IDS = ids(PHOBIAS);
const MODE_IDS = ids(MODES);

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
    // Campanhas criadas antes do modo imersivo existir continuam no modo clássico.
    mode: MODE_IDS.has(String(raw.mode)) ? raw.mode as CharacterMode : DEFAULT_CHARACTER.mode,
  };
};
