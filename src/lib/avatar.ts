import { createAvatar } from '@dicebear/core';
import type { Style } from '@dicebear/core';
import * as adventurer from '@dicebear/adventurer';
import * as adventurerNeutral from '@dicebear/adventurer-neutral';
import * as avataaars from '@dicebear/avataaars';
import * as avataaarsNeutral from '@dicebear/avataaars-neutral';
import * as bigEars from '@dicebear/big-ears';
import * as bigEarsNeutral from '@dicebear/big-ears-neutral';
import * as bigSmile from '@dicebear/big-smile';
import * as bottts from '@dicebear/bottts';
import * as botttsNeutral from '@dicebear/bottts-neutral';
import * as croodles from '@dicebear/croodles';
import * as croodlesNeutral from '@dicebear/croodles-neutral';
import * as dylan from '@dicebear/dylan';
import * as funEmoji from '@dicebear/fun-emoji';
import * as glass from '@dicebear/glass';
import * as icons from '@dicebear/icons';
import * as identicon from '@dicebear/identicon';
import * as initials from '@dicebear/initials';
import * as lorelei from '@dicebear/lorelei';
import * as loreleiNeutral from '@dicebear/lorelei-neutral';
import * as micah from '@dicebear/micah';
import * as miniavs from '@dicebear/miniavs';
import * as notionists from '@dicebear/notionists';
import * as notionistsNeutral from '@dicebear/notionists-neutral';
import * as openPeeps from '@dicebear/open-peeps';
import * as personas from '@dicebear/personas';
import * as pixelArt from '@dicebear/pixel-art';
import * as pixelArtNeutral from '@dicebear/pixel-art-neutral';
import * as rings from '@dicebear/rings';
import * as shapes from '@dicebear/shapes';
import * as thumbs from '@dicebear/thumbs';
import * as toonHead from '@dicebear/toon-head';
import type { AvatarStyleId } from './avatar-ids.js';

export { AVATAR_STYLE_IDS, DEFAULT_AVATAR_STYLE } from './avatar-ids.js';
export type { AvatarStyleId } from './avatar-ids.js';

/** Each style package, keyed by id. The Record type fails to compile if one is missing. */
const STYLES: Record<AvatarStyleId, unknown> = {
  'adventurer': adventurer,
  'adventurer-neutral': adventurerNeutral,
  'avataaars': avataaars,
  'avataaars-neutral': avataaarsNeutral,
  'big-ears': bigEars,
  'big-ears-neutral': bigEarsNeutral,
  'big-smile': bigSmile,
  'bottts': bottts,
  'bottts-neutral': botttsNeutral,
  'croodles': croodles,
  'croodles-neutral': croodlesNeutral,
  'dylan': dylan,
  'fun-emoji': funEmoji,
  'glass': glass,
  'icons': icons,
  'identicon': identicon,
  'initials': initials,
  'lorelei': lorelei,
  'lorelei-neutral': loreleiNeutral,
  'micah': micah,
  'miniavs': miniavs,
  'notionists': notionists,
  'notionists-neutral': notionistsNeutral,
  'open-peeps': openPeeps,
  'personas': personas,
  'pixel-art': pixelArt,
  'pixel-art-neutral': pixelArtNeutral,
  'rings': rings,
  'shapes': shapes,
  'thumbs': thumbs,
  'toon-head': toonHead,
};

export interface AvatarStyleInfo {
  id: AvatarStyleId;
  title: string;
  creator: string;
  license: string;
  licenseUrl: string;
  source: string;
}

interface StyleModule {
  create: unknown;
  meta?: { title?: string; creator?: string; source?: string; license?: { name?: string; url?: string } };
  schema?: unknown;
}

export function avatarStyleInfo(id: AvatarStyleId): AvatarStyleInfo {
  const meta = (STYLES[id] as StyleModule).meta ?? {};
  return {
    id,
    title: meta.title ?? id,
    creator: meta.creator ?? 'DiceBear',
    license: meta.license?.name ?? 'See DiceBear',
    licenseUrl: meta.license?.url ?? 'https://www.dicebear.com/licenses/',
    source: meta.source ?? 'https://www.dicebear.com/',
  };
}

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
export function renderAvatar(seed: string, size: AvatarSize, styleId: AvatarStyleId): string {
  // The package's own module object carries the schema with default options.
  const style = STYLES[styleId] as unknown as Style<Record<string, unknown>>;
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
