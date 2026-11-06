import { hash, verify } from '@node-rs/argon2';
import type { Options } from '@node-rs/argon2';

// Argon2id = 2. The numeric value avoids accessing an ambient const enum,
// which TypeScript disallows with verbatimModuleSyntax.
const ARGON_OPTIONS: Options = {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export function passwordLength(password: string): number {
  return [...password].length;
}

export function meetsPasswordPolicy(password: string): boolean {
  const length = passwordLength(password);
  return length >= PASSWORD_MIN_LENGTH && length <= PASSWORD_MAX_LENGTH;
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password, ARGON_OPTIONS);
  } catch {
    return false;
  }
}

// Used to keep failed-login timing roughly constant when the username does not exist.
let dummyHashPromise: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummyHashPromise ??= hash('wishlisto-dummy-password', ARGON_OPTIONS);
  return dummyHashPromise;
}
