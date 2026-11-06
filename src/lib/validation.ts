import { z } from 'zod';

const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);
const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

export function currencyExponent(currency: string): number {
  if (ZERO_DECIMAL.has(currency)) return 0;
  if (THREE_DECIMAL.has(currency)) return 3;
  return 2;
}

export function isCurrencyCode(code: string): boolean {
  return /^[A-Z]{3}$/.test(code);
}

export type PriceResult = { ok: true; minor: number | null } | { ok: false };

/**
 * Prices are entered by hand and stored as integer minor units.
 * Accepts "12.50", "12,50", "1200" (JPY) and rejects more fraction digits than the currency allows.
 */
export function parsePrice(raw: string, currency: string): PriceResult {
  const value = raw.trim();
  if (value === '') return { ok: true, minor: null };
  if (!isCurrencyCode(currency)) return { ok: false };
  if (!/^\d{1,9}([.,]\d{1,4})?$/.test(value)) return { ok: false };
  if (value.includes('.') && value.includes(',')) return { ok: false };

  const normalized = value.replace(',', '.');
  const [whole, fraction = ''] = normalized.split('.');
  const exponent = currencyExponent(currency);
  if (fraction.length > exponent) return { ok: false };
  const minor = Number(whole) * 10 ** exponent + Number(fraction.padEnd(exponent, '0') || '0');
  if (!Number.isSafeInteger(minor) || minor < 0) return { ok: false };
  return { ok: true, minor };
}

export function formatPrice(minor: number | null, currency: string, locale: string): string {
  if (minor === null) return '';
  const exponent = currencyExponent(currency);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
    }).format(minor / 10 ** exponent);
  } catch {
    return `${(minor / 10 ** exponent).toFixed(exponent)} ${currency}`;
  }
}

export function priceForInput(minor: number | null, currency: string): string {
  if (minor === null) return '';
  const exponent = currencyExponent(currency);
  return (minor / 10 ** exponent).toFixed(exponent);
}

export function isHttpUrl(value: string): boolean {
  if (value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (!url.hostname) return false;
    if (url.username || url.password) return false;
    return true;
  } catch {
    return false;
  }
}

export function normalizeHttpUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return '';
  if (!isHttpUrl(trimmed)) return null;
  return trimmed;
}

export function safeNextPath(value: string | undefined | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  return value;
}

export function cleanEmoji(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return '';
  if ([...trimmed].length > 8) return null;
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) return null;
  return trimmed;
}

const text = (
  max: number,
  options: { required?: string; maxKey?: string } = {},
): z.ZodType<string> =>
  z
    .string({ error: 'validation.required' })
    .trim()
    .refine((v) => !options.required || v.length > 0, { message: options.required ?? 'validation.required' })
    .refine((v) => [...v].length <= max, { message: options.maxKey ?? 'validation.name' });

const integerString = (pattern: RegExp, min: number, max: number, message: string) =>
  z
    .string({ error: message })
    .regex(pattern, { message })
    .transform(Number)
    .refine((n) => Number.isInteger(n) && n >= min && n <= max, { message });

export const listInputSchema = z.object({
  name: text(60, { required: 'validation.listNameRequired', maxKey: 'validation.listName' }),
  emoji: z.string().max(64, { message: 'validation.emoji' }).transform((v) => cleanEmoji(v)).refine((v) => v !== null, {
    message: 'validation.emoji',
  }),
  color: integerString(/^[0-7]$/, 0, 7, 'validation.required'),
  note: text(500, { maxKey: 'validation.note' }),
});
export type ListInput = z.infer<typeof listInputSchema>;

const itemFields = {
  title: text(120, { required: 'validation.itemTitleRequired', maxKey: 'validation.itemTitle' }),
  url: z
    .string()
    .trim()
    .max(2048, { message: 'validation.url' })
    .refine((v) => v === '' || isHttpUrl(v), { message: 'validation.url' }),
  price: z.string().trim(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .refine(isCurrencyCode, { message: 'validation.currency' }),
  quantity: integerString(/^\d{1,3}$/, 1, 999, 'validation.quantity'),
  priority: integerString(/^[0-3]$/, 0, 3, 'validation.priority'),
  notes: text(2000, { maxKey: 'validation.note' }),
  size: text(40, { maxKey: 'validation.name' }),
  color: text(40, { maxKey: 'validation.name' }),
  linkLabels: z.array(z.string().trim().max(40, { message: 'validation.linkLabel' })).max(5, { message: 'validation.tooManyLinks' }),
  linkUrls: z
    .array(z.string().trim().max(2048, { message: 'validation.link' }))
    .max(5, { message: 'validation.tooManyLinks' }),
};

export const itemInputSchema = z.object(itemFields).superRefine((value, ctx) => {
  if (value.price !== '') {
    const parsed = parsePrice(value.price, value.currency);
    if (!parsed.ok) ctx.addIssue({ code: 'custom', message: 'validation.price', path: ['price'] });
  }
  for (let index = 0; index < value.linkUrls.length; index += 1) {
    const url = value.linkUrls[index] ?? '';
    const label = value.linkLabels[index] ?? '';
    if (url !== '' && !isHttpUrl(url)) {
      ctx.addIssue({ code: 'custom', message: 'validation.link', path: ['linkUrls'] });
      break;
    }
    if (url === '' && label.trim() !== '') {
      ctx.addIssue({ code: 'custom', message: 'validation.link', path: ['linkUrls'] });
      break;
    }
  }
});
export type ItemInput = z.infer<typeof itemInputSchema>;

export function itemPrice(input: ItemInput): number | null {
  const parsed = parsePrice(input.price, input.currency);
  return parsed.ok ? parsed.minor : null;
}

export const groupInputSchema = z.object({
  name: text(60, { required: 'validation.groupNameRequired', maxKey: 'validation.groupName' }),
  note: text(500, { maxKey: 'validation.note' }),
});
export type GroupInput = z.infer<typeof groupInputSchema>;

export const languageInputSchema = z.object({
  locale: z.enum(['en', 'de', 'tr'], { message: 'validation.language' }),
});

export const loginInputSchema = z.object({
  username: z.string({ error: 'validation.required' }).max(64, { message: 'validation.usernameLength' }),
  password: z.string({ error: 'validation.required' }).min(1, { message: 'validation.required' }).max(128, { message: 'validation.passwordLength' }),
});

export const signupInputSchema = z
  .object({
    username: z.string({ error: 'validation.required' }).max(64, { message: 'validation.usernameLength' }),
    password: z.string({ error: 'validation.required' }).min(1, { message: 'validation.required' }).max(128, { message: 'validation.passwordLength' }),
    confirm: z.string({ error: 'validation.required' }),
  })
  .refine((v) => v.password === v.confirm, { message: 'validation.passwordMismatch', path: ['confirm'] });

export const recoverInputSchema = z
  .object({
    username: z.string({ error: 'validation.required' }).max(64, { message: 'validation.usernameLength' }),
    code: z.string({ error: 'validation.required' }).min(1, { message: 'validation.codeInvalid' }),
    password: z.string({ error: 'validation.required' }).min(1, { message: 'validation.required' }).max(128, { message: 'validation.passwordLength' }),
    confirm: z.string({ error: 'validation.required' }),
  })
  .refine((v) => v.password === v.confirm, { message: 'validation.passwordMismatch', path: ['confirm'] });

export const changePasswordSchema = z
  .object({
    current: z.string({ error: 'validation.required' }).min(1, { message: 'validation.required' }).max(128, { message: 'validation.passwordLength' }),
    password: z.string({ error: 'validation.required' }).min(1, { message: 'validation.required' }).max(128, { message: 'validation.passwordLength' }),
    confirm: z.string({ error: 'validation.required' }),
  })
  .refine((v) => v.password === v.confirm, { message: 'validation.passwordMismatch', path: ['confirm'] });

export const deleteAccountSchema = z.object({
  confirmUsername: z.string({ error: 'validation.required' }).min(1, { message: 'validation.required' }),
  password: z.string({ error: 'validation.required' }).min(1, { message: 'validation.required' }).max(128, { message: 'validation.passwordLength' }),
});

export const recoveryPasswordSchema = z.object({
  password: z.string({ error: 'validation.required' }).min(1, { message: 'validation.required' }).max(128, { message: 'validation.passwordLength' }),
});

export function zodErrorKeys(error: z.ZodError): string[] {
  const keys = error.issues.map((issue) => issue.message || 'validation.required');
  return [...new Set(keys)];
}
