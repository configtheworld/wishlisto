import { z } from 'zod';

/**
 * Colour tokens a self-hoster can change in site.json. The key is the name in
 * site.json, and the CSS variable is what the stylesheet reads.
 */
export const PALETTE_TOKENS = [
  { key: 'background', variable: '--bg' },
  { key: 'backgroundAccent', variable: '--bg-accent' },
  { key: 'surface', variable: '--surface' },
  { key: 'surfaceSoft', variable: '--surface-soft' },
  { key: 'surfaceStrong', variable: '--surface-strong' },
  { key: 'text', variable: '--text' },
  { key: 'textSoft', variable: '--text-soft' },
  { key: 'textFaint', variable: '--text-faint' },
  { key: 'line', variable: '--line' },
  { key: 'lineStrong', variable: '--line-strong' },
  { key: 'accent', variable: '--accent' },
  { key: 'accentStrong', variable: '--accent-strong' },
  { key: 'accentSoft', variable: '--accent-soft' },
  { key: 'accentInk', variable: '--accent-ink' },
  { key: 'secondary', variable: '--secondary' },
  { key: 'secondarySoft', variable: '--secondary-soft' },
  { key: 'success', variable: '--success' },
  { key: 'successSoft', variable: '--success-soft' },
  { key: 'danger', variable: '--danger' },
  { key: 'dangerSoft', variable: '--danger-soft' },
  { key: 'star', variable: '--star' },
  { key: 'avatarBlob', variable: '--avatar-blob' },
  { key: 'tone0', variable: '--tone-0' },
  { key: 'tone1', variable: '--tone-1' },
  { key: 'tone2', variable: '--tone-2' },
  { key: 'tone3', variable: '--tone-3' },
  { key: 'tone4', variable: '--tone-4' },
  { key: 'tone5', variable: '--tone-5' },
  { key: 'tone6', variable: '--tone-6' },
  { key: 'tone7', variable: '--tone-7' },
] as const;

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const shape: Record<string, z.ZodOptional<z.ZodString>> = {};
for (const token of PALETTE_TOKENS) {
  shape[token.key] = z.string().regex(HEX, { message: 'must be a hex colour like #a63d78' }).optional();
}

/** Each key is optional. Anything left out keeps the built-in colour. */
export const paletteSchema = z.object(shape).strict();
export type Palette = z.infer<typeof paletteSchema>;

export interface PaletteConfig {
  light?: Palette;
  dark?: Palette;
}

/** Stylesheet with only the overrides, so the built-in palette stays the fallback. */
export function paletteCss(palettes: PaletteConfig = {}): string {
  const block = (selector: string, palette: Palette | undefined): string => {
    const lines = PALETTE_TOKENS.filter((token) => palette?.[token.key] !== undefined).map(
      (token) => `  ${token.variable}: ${palette?.[token.key]};`,
    );
    return lines.length === 0 ? '' : `${selector} {\n${lines.join('\n')}\n}\n`;
  };
  return [block(':root', palettes.light), block(':root[data-theme="dark"]', palettes.dark)].filter(Boolean).join('\n');
}

/** The browser-chrome colour, taken from the background token when set. */
export function themeColor(palettes: PaletteConfig, mode: 'light' | 'dark'): string {
  const fallback = mode === 'light' ? '#faf7fc' : '#1b1420';
  return palettes[mode]?.background ?? fallback;
}
