import { describe, expect, it } from 'vitest';
import { legendDurationMs, legendTimings, MAX_LEGEND_CHARS, SOLO_LEGEND_MS, splitLegend } from '../src/systems/legends';

describe('legendas', () => {
  it('mantém um texto curto inteiro', () => {
    expect(splitLegend('A porta range.')).toEqual(['A porta range.']);
  });

  it('não devolve legenda nenhuma para um texto vazio', () => {
    expect(splitLegend('   ')).toEqual([]);
  });

  it('divide um texto acima de oitenta caracteres', () => {
    const long = 'O corredor continua muito além do que a lanterna alcança e o cheiro de mofo fica mais forte a cada passo que você dá.';
    const parts = splitLegend(long);
    expect(parts.length).toBeGreaterThan(1);
    parts.forEach((part) => expect(part.length).toBeLessThanOrEqual(MAX_LEGEND_CHARS));
    expect(parts.join(' ')).toBe(long);
  });

  it('reparte um texto longo em pedaços de tamanho parecido', () => {
    const parts = splitLegend(`${'palavra '.repeat(18)}fim`);
    const sizes = parts.map((part) => part.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThan(MAX_LEGEND_CHARS / 2);
  });

  it('corta uma palavra que sozinha não cabe em uma legenda', () => {
    const parts = splitLegend('a'.repeat(200));
    expect(parts.length).toBe(3);
    parts.forEach((part) => expect(part.length).toBeLessThanOrEqual(MAX_LEGEND_CHARS));
  });

  it('dá oito segundos a uma legenda sozinha', () => {
    expect(legendTimings(['A porta range.'])).toEqual([SOLO_LEGEND_MS]);
  });

  it('usa a tabela de tamanhos quando há legendas em sequência', () => {
    const parts = ['curta demais', 'a'.repeat(35), 'a'.repeat(55), 'a'.repeat(75)];
    expect(legendTimings(parts)).toEqual([1900, 2500, 3750, 5250]);
  });

  it('respeita os intervalos recomendados por faixa', () => {
    expect(legendDurationMs('a'.repeat(20))).toBeGreaterThanOrEqual(1800);
    expect(legendDurationMs('a'.repeat(20))).toBeLessThanOrEqual(2000);
    expect(legendDurationMs('a'.repeat(40))).toBeGreaterThanOrEqual(2000);
    expect(legendDurationMs('a'.repeat(40))).toBeLessThanOrEqual(3000);
    expect(legendDurationMs('a'.repeat(60))).toBeGreaterThanOrEqual(3000);
    expect(legendDurationMs('a'.repeat(60))).toBeLessThanOrEqual(4500);
    expect(legendDurationMs('a'.repeat(80))).toBeGreaterThanOrEqual(4500);
    expect(legendDurationMs('a'.repeat(80))).toBeLessThanOrEqual(6000);
  });
});
