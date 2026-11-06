import deCatalog from '../i18n/de.json';
import enCatalog from '../i18n/en.json';
import trCatalog from '../i18n/tr.json';

export type Locale = 'en' | 'de' | 'tr';
export const LOCALES: readonly Locale[] = ['en', 'de', 'tr'];
export const DEFAULT_LOCALE: Locale = 'en';

type Catalog = Record<string, string>;

function flatten(input: unknown, prefix = '', out: Catalog = {}): Catalog {
  if (!input || typeof input !== 'object') return out;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') flatten(value, path, out);
    else if (typeof value === 'string') out[path] = value;
  }
  return out;
}

const catalogs: Record<Locale, Catalog> = {
  en: flatten(enCatalog),
  de: flatten(deCatalog),
  tr: flatten(trCatalog),
};

export type Vars = Record<string, string | number>;

export function translate(locale: Locale, key: string, vars?: Vars): string {
  const template = catalogs[locale][key] ?? catalogs.en[key];
  if (template === undefined) return key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

export function translator(locale: Locale): (key: string, vars?: Vars) => string {
  return (key, vars) => translate(locale, key, vars);
}

export function plural(locale: Locale, baseKey: string, count: number, vars?: Vars): string {
  const category = new Intl.PluralRules(locale).select(count);
  const key = `${baseKey}.${category}`;
  const fallback = `${baseKey}.other`;
  const template = catalogs[locale][key] ?? catalogs[locale][fallback] ?? catalogs.en[key] ?? catalogs.en[fallback];
  if (template === undefined) return baseKey;
  return translate(locale, key, { count, ...vars });
}

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'de' || value === 'tr';
}

export function localeFromAcceptLanguage(header: string | undefined | null): Locale {
  if (!header) return DEFAULT_LOCALE;
  const entries = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return {
        tag: (tag ?? '').trim().toLowerCase(),
        q: q ? Number(q.split('=')[1]) || 0 : 1,
      };
    })
    .sort((a, b) => b.q - a.q);
  for (const entry of entries) {
    const base = entry.tag.split('-')[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}
