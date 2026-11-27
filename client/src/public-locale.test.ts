import { describe, expect, it } from 'vitest';
import { publicLocale } from './public-locale';
import { LOCALE_STORAGE_KEY } from '../../shared/i18n';

const storage = (value: string | null) => ({ getItem: (key: string) => (key === LOCALE_STORAGE_KEY ? value : null) });

describe('publicLocale (escritório público)', () => {
  it('começa em pt-BR sem escolha salva, qualquer que seja o idioma do navegador', () => {
    expect(publicLocale(storage(null))).toBe('pt-BR');
    expect(publicLocale(undefined)).toBe('pt-BR');
  });
  it('mantém a escolha explícita feita em Configurações', () => {
    expect(publicLocale(storage('en'))).toBe('en');
    expect(publicLocale(storage('fr'))).toBe('fr');
  });
  it('valor inválido ou storage bloqueado: pt-BR', () => {
    expect(publicLocale(storage('xx'))).toBe('pt-BR');
    expect(publicLocale({ getItem: () => { throw new Error('bloqueado'); } })).toBe('pt-BR');
  });
});
