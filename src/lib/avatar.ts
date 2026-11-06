import { createAvatar } from '@dicebear/core';
import type { Style } from '@dicebear/core';
import * as identicon from '@dicebear/identicon';

/**
 * Every avatar is an Identicon (DiceBear, CC0 1.0), seeded by the username.
 * Users cannot change it, so it needs no settings and no credit line.
 */
export const AVATAR_STYLE_ID = 'identicon';

export type AvatarSize = 48 | 64 | 96 | 128 | 256;
const SIZES: readonly number[] = [48, 64, 96, 128, 256];

export function parseAvatarSize(raw: string | undefined): AvatarSize {
  const n = Number(raw ?? 96);
  return (SIZES.includes(n) ? n : 96) as AvatarSize;
}

/**
 * DiceBear renders locally and we additionally strip anything that could ever
 * execute or fetch, so even a compromised style package cannot produce an
 * active SVG.
 */
export function renderAvatar(seed: string, size: AvatarSize = 96): string {
  // The package's own module object carries the schema with default options.
  const style = identicon as unknown as Style<Record<string, unknown>>;
  const svg = createAvatar(style, { seed: seed.slice(0, 40), size }).toString();
  return sanitizeSvg(svg);
}

export function sanitizeSvg(input: string): string {
  let svg = input;
  svg = svg.replace(/<\?xml[\s\S]*?\?>/gi, '');
  svg = svg.replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  svg = svg.replace(/<!--[\s\S]*?-->/g, '');
  svg = svg.replace(/<\s*(script|foreignObject|iframe|object|embed|image|animate|animateMotion|animateTransform|set|discard|handler)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  svg = svg.replace(/<\s*(script|foreignObject|iframe|object|embed|image|animate|animateMotion|animateTransform|set|discard|handler)\b[^>]*\/?\s*>/gi, '');
  svg = svg.replace(/<\s*style\b[\s\S]*?<\s*\/\s*style\s*>/gi, '');
  // Metadata is only attribution text and can contain arbitrary URLs; credits live in Settings.
  svg = svg.replace(/<\s*metadata\b[\s\S]*?<\s*\/\s*metadata\s*>/gi, '');
  svg = svg.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  svg = svg.replace(/(href|xlink:href)\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, '');
  svg = svg.replace(/javascript:/gi, '');
  svg = svg.replace(/url\(\s*(?!#)[^)]*\)/gi, '');
  if (!svg.trimStart().toLowerCase().startsWith('<svg')) {
    throw new Error('Avatar renderer did not produce an SVG');
  }
  return svg;
}
