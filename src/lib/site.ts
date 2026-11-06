import fs from 'node:fs';
import { z } from 'zod';
import { paletteSchema } from './palette.js';
import type { Locale } from './i18n.js';

/** Icons a self-hoster can choose for landing feature cards. */
export const FEATURE_ICONS = ['lock', 'users', 'link', 'gift', 'sparkles', 'heart', 'list', 'shield'] as const;

/** Text in each language. English is required and is the fallback for missing languages. */
const localizedText = z
  .record(z.enum(['en', 'de', 'tr']), z.string().trim().min(1).max(400))
  .refine((value) => typeof value.en === 'string', { message: 'English text is required' });

const siteSchema = z.object({
  appName: z.string().trim().min(1).max(40),
  tagline: localizedText,
  colors: z
    .object({
      light: paletteSchema.optional(),
      dark: paletteSchema.optional(),
    })
    .optional(),
  landing: z.object({
    title: localizedText,
    intro: localizedText,
    features: z
      .array(
        z.object({
          icon: z.enum(FEATURE_ICONS),
          title: localizedText,
          text: localizedText,
        }),
      )
      .min(1)
      .max(4),
  }),
});

export type SiteConfig = z.infer<typeof siteSchema>;
export type LocalizedText = z.infer<typeof localizedText>;

export class SiteConfigError extends Error {}

export function loadSiteConfig(file: string): SiteConfig {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    throw new SiteConfigError(`Cannot read site config at ${file}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new SiteConfigError(`Site config at ${file} is not valid JSON`);
  }
  const parsed = siteSchema.safeParse(json);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new SiteConfigError(`Invalid site config at ${file}: ${details}`);
  }
  return parsed.data;
}

/** Picks the text for a locale, falling back to English. */
export function localized(text: LocalizedText, locale: Locale): string {
  return text[locale] ?? text.en;
}

