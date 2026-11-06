import { hashPassword, verifyPassword } from './password.js';
import { randomInt } from './ids.js';

// Crockford Base32: no I, L, O or U, which are easy to misread.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 20;

export function generateRecoveryCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

export function formatRecoveryCode(code: string): string {
  return code.replace(/(.{5})/g, '$1-').replace(/-$/, '');
}

export function normalizeRecoveryCode(input: string): string | null {
  const cleaned = String(input ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V');
  if (!new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`).test(cleaned)) return null;
  return cleaned;
}

export async function hashRecoveryCode(code: string): Promise<string> {
  return hashPassword(code);
}

export async function verifyRecoveryCode(storedHash: string | null, input: string): Promise<boolean> {
  const normalized = normalizeRecoveryCode(input);
  if (!storedHash || !normalized) return false;
  return verifyPassword(storedHash, normalized);
}
