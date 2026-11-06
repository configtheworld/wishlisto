import { randomInt } from './ids.js';

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;

const ALLOWED = /^[\p{L}\p{N}](?:[\p{L}\p{N}._-]*[\p{L}\p{N}])?$/u;
const SEPARATOR_RUN = /[._-]{2,}/;

// A pragmatic subset of Unicode confusable mapping (UTS #39-ish), not a complete implementation.
// The goal is that "аlice" (Cyrillic а) and "alice" can never both exist, nor can "Jörg"/"Jorg".
const CONFUSABLES: Record<string, string> = {
  // Cyrillic
  а: 'a', б: 'b', в: 'b', г: 'r', д: 'd', е: 'e', ё: 'e', ж: 'x', з: '3', и: 'u', й: 'u',
  к: 'k', л: 'n', м: 'm', н: 'h', о: 'o', п: 'n', р: 'p', с: 'c', т: 't', у: 'y', ф: 'f',
  х: 'x', ц: 'u', ч: '4', ш: 'w', щ: 'w', ъ: 'b', ы: 'bl', ь: 'b', э: 'e', ю: 'io', я: 'r',
  і: 'i', ї: 'i', ј: 'j', є: 'e', ґ: 'r', ў: 'y',
  // Greek
  α: 'a', β: 'b', γ: 'y', δ: 'd', ε: 'e', ζ: 'z', η: 'n', θ: 'o', ι: 'i', κ: 'k', λ: 'l',
  μ: 'u', ν: 'v', ξ: 'e', ο: 'o', π: 'n', ρ: 'p', σ: 'o', ς: 'c', τ: 't', υ: 'u', φ: 'o',
  χ: 'x', ψ: 'w', ω: 'w',
  // Latin extras and common lookalikes
  ı: 'i', ł: 'l', ø: 'o', đ: 'd', ð: 'd', þ: 'p', ß: 'ss', æ: 'ae', œ: 'oe', ſ: 's',
  ĸ: 'k', ı̇: 'i',
};

export type UsernameResult =
  | { ok: true; username: string; usernameCi: string; usernameSkel: string }
  | { ok: false; code: 'length' | 'charset' | 'separators' };

export function normalizeUsername(raw: string): string {
  return String(raw ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

export function usernameToCi(username: string): string {
  return username.normalize('NFKC').toLowerCase();
}

export function usernameSkeleton(username: string): string {
  let value = username.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();
  value = [...value].map((ch) => CONFUSABLES[ch] ?? ch).join('');
  // Digits that are routinely used to imitate letters.
  value = value.replace(/0/g, 'o').replace(/1/g, 'l').replace(/5/g, 's');
  // "i" and "l" are nearly identical in many sans-serif fonts.
  value = value.replace(/i/g, 'l');
  return value;
}

export function validateUsername(raw: string): UsernameResult {
  const username = normalizeUsername(raw);
  const length = [...username].length;
  if (length < USERNAME_MIN_LENGTH || length > USERNAME_MAX_LENGTH) {
    return { ok: false, code: 'length' };
  }
  if (!ALLOWED.test(username)) {
    return { ok: false, code: 'charset' };
  }
  if (SEPARATOR_RUN.test(username)) {
    return { ok: false, code: 'separators' };
  }
  return {
    ok: true,
    username,
    usernameCi: usernameToCi(username),
    usernameSkel: usernameSkeleton(username),
  };
}

export function normalizeUsernameKey(raw: string): string {
  return usernameToCi(normalizeUsername(raw));
}

export function isValidAvatarSeed(seed: string): boolean {
  return /^[\p{L}\p{N} ._'’-]{1,40}$/u.test(seed);
}

export function randomAvatarSeed(): string {
  const adjectives = ['sunny', 'cosy', 'brave', 'mellow', 'tiny', 'quirky', 'peachy', 'dreamy', 'jolly', 'soft'];
  const nouns = ['otter', 'peach', 'cloud', 'mochi', 'sprout', 'comet', 'puffin', 'willow', 'muffin', 'star'];
  return `${adjectives[randomInt(adjectives.length)]}-${nouns[randomInt(nouns.length)]}-${randomInt(900) + 100}`;
}
