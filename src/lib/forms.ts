import type { FormBody } from '../types.js';

export function formString(body: FormBody | null, key: string, fallback = ''): string {
  if (!body) return fallback;
  const value = body[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === 'string');
    if (typeof first === 'string') return first;
  }
  return fallback;
}

export function formStrings(body: FormBody | null, key: string): string[] {
  if (!body) return [];
  const value = body[key];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
  return [];
}

export function formFile(body: FormBody | null, key: string): File | null {
  if (!body) return null;
  const value = body[key];
  if (value instanceof File) return value;
  if (Array.isArray(value)) {
    const file = value.find((entry) => entry instanceof File);
    if (file instanceof File) return file;
  }
  return null;
}
