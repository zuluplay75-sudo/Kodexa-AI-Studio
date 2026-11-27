// Idioma do escritório público: português do Brasil, a menos que a pessoa tenha escolhido outro em Configurações ›
// Idioma (preferência salva neste navegador). O escritório local segue o idioma do navegador (shared/i18n.ts); aqui
// não, porque o Kodexa é um produto em pt-BR e um navegador em inglês não é uma escolha de idioma.
// Este módulo é o PRIMEIRO import de public-office.ts: vários módulos da interface chamam tr() ao carregar.
import { LOCALE_STORAGE_KEY, normalizeLocale, setLocale, type Locale } from '../../shared/i18n';

/** Idioma inicial: a escolha salva, se houver; senão pt-BR. */
export function publicLocale(storage: Pick<Storage, 'getItem'> | undefined): Locale {
  try {
    return normalizeLocale(storage?.getItem(LOCALE_STORAGE_KEY)) ?? 'pt-BR';
  } catch {
    return 'pt-BR';
  }
}

if (typeof window !== 'undefined') {
  let storage: Storage | undefined;
  try {
    storage = window.localStorage;
  } catch {
    storage = undefined;
  }
  const locale = publicLocale(storage);
  setLocale(locale);
  // Leitores de tela e o corretor do navegador seguem o atributo lang (o HTML do servidor vem com pt-BR).
  document.documentElement.lang = locale;
}
