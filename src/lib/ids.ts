import { randomBytes } from 'node:crypto';

export function randomId(bytes = 16): string {
  return randomBytes(bytes).toString('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function randomInt(maxExclusive: number): number {
  // Rejection sampling keeps the distribution uniform.
  if (maxExclusive <= 0) throw new Error('maxExclusive must be positive');
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  let value: number;
  do {
    value = randomBytes(4).readUInt32BE(0);
  } while (value >= limit);
  return value % maxExclusive;
}
