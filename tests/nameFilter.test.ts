import { describe, expect, it } from 'vitest';
import { checkCharacterName, nameIsAllowed } from '../src/config/nameFilter';

describe('filtro de linguagem do nome', () => {
  it('aceita nomes comuns', () => {
    ['Helena', 'João Vitor', 'Marcos Pinto', 'Ana-Clara', 'Zé do Caixão', 'Enviado', 'Desviado', 'Reputação', 'Disputa', 'Bichano']
      .forEach((name) => expect(nameIsAllowed(name), name).toBe(true));
  });

  it('recusa ofensas escritas por extenso', () => {
    ['nigger', 'Crioulo', 'Traveco', 'Boiola', 'Heil Hitler', 'retardado', 'Filho da Puta', 'estuprador']
      .forEach((name) => expect(nameIsAllowed(name), name).toBe(false));
  });

  it('recusa ofensas disfarçadas com números', () => {
    ['n1gg3r', 'V14D0', 'h1tl3r', 'f1lh0 d4 put4', 'cr10ul0']
      .forEach((name) => expect(nameIsAllowed(name), name).toBe(false));
  });

  it('recusa ofensas picadas por pontuação ou espaços', () => {
    ['p.u.t.a', 'v i a d o', 'n-i-g-g-e-r', 'h_i_t_l_e_r']
      .forEach((name) => expect(nameIsAllowed(name), name).toBe(false));
  });

  it('recusa ofensas com letras esticadas', () => {
    ['viaaaado', 'puuuta', 'niiiggeeer', 'bucetaaa']
      .forEach((name) => expect(nameIsAllowed(name), name).toBe(false));
  });

  it('recusa códigos numéricos de apologia', () => {
    expect(nameIsAllowed('Rafa 1488')).toBe(false);
  });

  it('devolve o motivo quando recusa', () => {
    const check = checkCharacterName('viado');
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/ofensa/i);
  });

  it('não recusa um nome vazio — isso é trabalho do tamanho mínimo', () => {
    expect(nameIsAllowed('')).toBe(true);
  });
});
