import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  currencyExponent,
  formatPrice,
  parsePrice,
  priceForInput,
  safeNextPath,
  cleanEmoji,
  isHttpUrl,
} from '../src/lib/validation.js';
import { usernameSkeleton, validateUsername, normalizeUsername } from '../src/lib/username.js';
import { formatRecoveryCode, generateRecoveryCode, normalizeRecoveryCode } from '../src/lib/recovery.js';
import { sanitizeSvg } from '../src/lib/avatar.js';
import { processImage, ImageError } from '../src/lib/images.js';
import { plural, translate, localeFromAcceptLanguage } from '../src/lib/i18n.js';
import en from '../src/i18n/en.json' with { type: 'json' };
import de from '../src/i18n/de.json' with { type: 'json' };
import tr from '../src/i18n/tr.json' with { type: 'json' };

function flattenKeys(input: unknown, prefix = ''): string[] {
  if (!input || typeof input !== 'object') return [];
  return Object.entries(input as Record<string, unknown>).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object' ? flattenKeys(value, path) : [path];
  });
}

test('price parsing stores exact minor units', () => {
  assert.deepEqual(parsePrice('12.50', 'EUR'), { ok: true, minor: 1250 });
  assert.deepEqual(parsePrice('12,50', 'EUR'), { ok: true, minor: 1250 });
  assert.deepEqual(parsePrice('1200', 'JPY'), { ok: true, minor: 1200 });
  assert.deepEqual(parsePrice('1.234', 'KWD'), { ok: true, minor: 1234 });
  assert.deepEqual(parsePrice('0', 'EUR'), { ok: true, minor: 0 });
  assert.deepEqual(parsePrice('', 'EUR'), { ok: true, minor: null });
  assert.deepEqual(parsePrice('12.555', 'EUR'), { ok: false });
  assert.deepEqual(parsePrice('12', 'JPY'), { ok: true, minor: 12 });
  assert.deepEqual(parsePrice('1.2', 'JPY'), { ok: false });
  assert.deepEqual(parsePrice('1.2345', 'KWD'), { ok: false });
  assert.deepEqual(parsePrice('1.2.3', 'EUR'), { ok: false });
  assert.deepEqual(parsePrice('-1', 'EUR'), { ok: false });
  assert.deepEqual(parsePrice('abc', 'EUR'), { ok: false });
  assert.equal(currencyExponent('JPY'), 0);
  assert.equal(currencyExponent('KWD'), 3);
  assert.equal(currencyExponent('EUR'), 2);
});

test('price formatting round-trips through the form input helper', () => {
  for (const [minor, currency] of [
    [1250, 'EUR'],
    [0, 'EUR'],
    [1234, 'KWD'],
    [1200, 'JPY'],
    [null, 'EUR'],
  ] as const) {
    const raw = priceForInput(minor, currency);
    const parsed = parsePrice(raw, currency);
    assert.deepEqual(parsed, { ok: true, minor });
  }
  assert.match(formatPrice(1250, 'EUR', 'en'), /12\.50/);
});

test('URL and emoji validation rejects active or ambiguous input', () => {
  assert.equal(isHttpUrl('https://example.com/a?b=1'), true);
  assert.equal(isHttpUrl('http://example.com'), true);
  assert.equal(isHttpUrl('javascript:alert(1)'), false);
  assert.equal(isHttpUrl('data:text/html,hi'), false);
  assert.equal(isHttpUrl('https://user:pass@example.com'), false);
  assert.equal(isHttpUrl('example.com'), false);
  assert.equal(safeNextPath('/lists/abc?x=1'), '/lists/abc?x=1');
  assert.equal(safeNextPath('//evil.example'), null);
  assert.equal(safeNextPath('/\\evil'), null);
  assert.equal(safeNextPath('https://evil.example'), null);
  assert.equal(cleanEmoji('🎂'), '🎂');
  assert.equal(cleanEmoji(''), '');
  assert.equal(cleanEmoji('a'.repeat(9)), null);
  assert.equal(cleanEmoji('\u0000'), null);
});

test('usernames are Unicode-safe, case-insensitive and confusable-resistant', () => {
  assert.equal(normalizeUsername('  Jörg  '), 'Jörg');
  const alice = validateUsername('alice');
  assert.equal(alice.ok, true);
  if (!alice.ok) return;
  assert.equal(alice.usernameCi, 'alice');
  assert.equal(alice.usernameSkel, 'allce');

  // Cyrillic "аlice" must collide with Latin "alice".
  const cyrillic = validateUsername('аlice');
  assert.equal(cyrillic.ok, true);
  if (!cyrillic.ok) return;
  assert.equal(cyrillic.usernameSkel, alice.usernameSkel);

  // Digit/letter lookalikes and i/l folding.
  assert.equal(usernameSkeleton('b0b'), usernameSkeleton('bob'));
  assert.equal(usernameSkeleton('alice'), usernameSkeleton('a1ice'));
  assert.equal(usernameSkeleton('Jörg'), usernameSkeleton('Jorg'));

  assert.deepEqual(validateUsername('ab'), { ok: false, code: 'length' });
  assert.deepEqual(validateUsername('a'.repeat(33)), { ok: false, code: 'length' });
  assert.deepEqual(validateUsername('bad name'), { ok: false, code: 'charset' });
  assert.deepEqual(validateUsername('-bad'), { ok: false, code: 'charset' });
  assert.deepEqual(validateUsername('bad__name'), { ok: false, code: 'separators' });
  assert.equal(validateUsername('äöü_小.星-1').ok, true);
});

test('recovery codes use Crockford base32 and normalize lookalikes', () => {
  const code = generateRecoveryCode();
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{20}$/);
  assert.equal(formatRecoveryCode(code), code.replace(/(.{5})(?=.)/g, '$1-'));
  assert.equal(normalizeRecoveryCode(formatRecoveryCode(code)), code);
  assert.equal(normalizeRecoveryCode(code.toLowerCase()), code);
  // I/L -> 1, O -> 0, U -> V
  const withLookalikes = code.slice(0, 4).replace(/1/g, 'I').replace(/0/g, 'O') + code.slice(4);
  const normalized = normalizeRecoveryCode(withLookalikes);
  assert.equal(normalized?.length, 20);
  assert.equal(normalizeRecoveryCode('too-short'), null);
  assert.equal(normalizeRecoveryCode('!'.repeat(20)), null);
});

test('SVG sanitizer removes scripts, events and external references', () => {
  const hostile =
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">' +
    '<script>alert(1)</script><style>@import url(https://evil.test/x.css)</style>' +
    '<a href="https://evil.test"><text>hi</text></a>' +
    '<image href="https://evil.test/x.png"/><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"/></foreignObject>' +
    '<rect fill="url(https://evil.test/p.svg)" onclick="x()"/></svg>';
  const clean = sanitizeSvg(hostile);
  assert.ok(clean.toLowerCase().startsWith('<svg'));
  assert.doesNotMatch(clean, /<script/i);
  assert.doesNotMatch(clean, /onload|onclick/i);
  assert.doesNotMatch(clean, /javascript:/i);
  assert.doesNotMatch(clean, /https:\/\/evil\.test/i);
  assert.doesNotMatch(clean, /<foreignObject/i);
  assert.doesNotMatch(clean, /<image/i);
  assert.throws(() => sanitizeSvg('<html></html>'));
});

test('image pipeline accepts raster magic bytes only and strips metadata', async () => {
  const png = await sharp({
    create: { width: 40, height: 30, channels: 3, background: { r: 200, g: 100, b: 160 } },
  })
    .png()
    .withMetadata({ exif: { IFD0: { Copyright: 'test-metadata' } } })
    .toBuffer();
  const processed = await processImage(png);
  assert.equal(processed.width, 40);
  assert.equal(processed.height, 30);
  const meta = await sharp(processed.data).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.exif, undefined);

  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  await assert.rejects(processImage(svg), (error: unknown) => {
    return error instanceof ImageError && error.code === 'unsupported_type';
  });

  const fakePng = Buffer.from('this is not an image at all');
  await assert.rejects(processImage(fakePng), (error: unknown) => {
    return error instanceof ImageError && error.code === 'unsupported_type';
  });

  const brokenPng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('broken')]);
  await assert.rejects(processImage(brokenPng), (error: unknown) => {
    return error instanceof ImageError && error.code === 'invalid_image';
  });
});

test('image pipeline downscales oversized dimensions', async () => {
  const huge = await sharp({
    create: { width: 2000, height: 1200, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .jpeg()
    .toBuffer();
  const processed = await processImage(huge);
  assert.equal(processed.width, 1600);
  assert.equal(processed.height, 960);
});

test('translation catalogs are complete and pluralized', () => {
  const enKeys = flattenKeys(en).sort();
  const deKeys = flattenKeys(de).sort();
  assert.deepEqual(deKeys, enKeys, 'DE catalog must have exactly the same keys as EN');
  assert.deepEqual(flattenKeys(tr).sort(), enKeys, 'TR catalog must have exactly the same keys as EN');
  assert.equal(translate('en', 'nav.lists'), 'My lists');
  assert.notEqual(translate('de', 'nav.lists'), 'nav.lists');
  assert.equal(translate('en', 'does.not.exist'), 'does.not.exist');
  assert.match(plural('en', 'count.wish', 1), /1/);
  assert.match(plural('en', 'count.wish', 3), /3/);
  assert.match(plural('de', 'count.wish', 3), /3/);
  assert.equal(localeFromAcceptLanguage('de-DE,de;q=0.9,en;q=0.5'), 'de');
  assert.equal(localeFromAcceptLanguage('fr-FR,en;q=0.2'), 'en');
  assert.equal(localeFromAcceptLanguage(undefined), 'en');
});
