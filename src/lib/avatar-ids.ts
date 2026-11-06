/**
 * Every DiceBear style this app can render. Kept dependency-free so the config
 * can validate AVATAR_STYLE without loading the artwork packages.
 */
export const AVATAR_STYLE_IDS = [
  'adventurer',
  'adventurer-neutral',
  'avataaars',
  'avataaars-neutral',
  'big-ears',
  'big-ears-neutral',
  'big-smile',
  'bottts',
  'bottts-neutral',
  'croodles',
  'croodles-neutral',
  'dylan',
  'fun-emoji',
  'glass',
  'icons',
  'identicon',
  'initials',
  'lorelei',
  'lorelei-neutral',
  'micah',
  'miniavs',
  'notionists',
  'notionists-neutral',
  'open-peeps',
  'personas',
  'pixel-art',
  'pixel-art-neutral',
  'rings',
  'shapes',
  'thumbs',
  'toon-head',
] as const;

export type AvatarStyleId = (typeof AVATAR_STYLE_IDS)[number];

export const DEFAULT_AVATAR_STYLE: AvatarStyleId = 'initials';
