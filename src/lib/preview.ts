import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

/**
 * Link previews read only SEO metadata (title and description) from a page the
 * user explicitly asked for. The fetch is SSRF-hardened: only http(s) on the
 * default ports, every resolved address must be public, the connection is
 * pinned to the validated address (so DNS rebinding cannot swap in a private
 * one), redirects are re-validated, and responses are small and time-limited.
 */

export interface LinkMetadata {
  title: string;
  description: string;
}

const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const HOP_TIMEOUT_MS = 4000;
const TOTAL_TIMEOUT_MS = 8000;

const blocked = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
] as const) {
  blocked.addSubnet(address, prefix, 'ipv4');
}
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(address, prefix, 'ipv6');
}

export function isPublicAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const ip = mapped?.[1] ?? address;
  if (net.isIPv4(ip)) return !blocked.check(ip, 'ipv4');
  if (net.isIPv6(ip)) return !blocked.check(ip, 'ipv6');
  return false;
}

type Resolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const systemResolver: Resolver = (hostname) => dns.lookup(hostname, { all: true, verbatim: true });

function pinnedLookup(resolve: Resolver) {
  return (
    hostname: string,
    options: { all?: boolean },
    callback: (error: Error | null, address?: unknown, family?: number) => void,
  ): void => {
    resolve(hostname).then(
      (records) => {
        if (records.length === 0 || records.some((record) => !isPublicAddress(record.address))) {
          callback(new Error('Blocked address'));
          return;
        }
        if (options.all) callback(null, records);
        else callback(null, records[0]?.address, records[0]?.family);
      },
      (error: Error) => callback(error),
    );
  };
}

function allowedUrl(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  // Only default web ports, so the feature cannot be used to probe internal services.
  return url.port === '';
}

type HopResult = { kind: 'redirect'; location: string } | { kind: 'html'; html: string } | { kind: 'none' };

function fetchHop(url: URL, resolve: Resolver): Promise<HopResult> {
  return new Promise((done) => {
    const client = url.protocol === 'https:' ? https : http;
    const request = client.get(
      url,
      {
        lookup: pinnedLookup(resolve) as unknown as http.RequestOptions['lookup'],
        timeout: HOP_TIMEOUT_MS,
        headers: { accept: 'text/html', 'user-agent': 'Wishlisto-link-preview' },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if (status >= 300 && status < 400 && location) {
          response.resume();
          done({ kind: 'redirect', location });
          return;
        }
        const type = String(response.headers['content-type'] ?? '');
        if (status !== 200 || !/^text\/html\b/i.test(type)) {
          response.resume();
          done({ kind: 'none' });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            request.destroy();
            done({ kind: 'html', html: Buffer.concat(chunks).toString('utf8') });
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => done({ kind: 'html', html: Buffer.concat(chunks).toString('utf8') }));
        response.on('error', () => done({ kind: 'none' }));
      },
    );
    request.on('timeout', () => request.destroy());
    request.on('error', () => done({ kind: 'none' }));
  });
}

async function followRedirects(start: URL, resolve: Resolver): Promise<LinkMetadata | null> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!allowedUrl(current)) return null;
    const host = current.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && !isPublicAddress(host)) return null;
    const result = await fetchHop(current, resolve);
    if (result.kind === 'html') return extractMetadata(result.html);
    if (result.kind === 'none') return null;
    try {
      current = new URL(result.location, current);
    } catch {
      return null;
    }
  }
  return null;
}

export async function fetchLinkMetadata(rawUrl: string, resolve: Resolver = systemResolver): Promise<LinkMetadata | null> {
  let start: URL;
  try {
    start = new URL(rawUrl);
  } catch {
    return null;
  }
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((done) => {
    timer = setTimeout(() => done(null), TOTAL_TIMEOUT_MS);
  });
  try {
    return await Promise.race([followRedirects(start, resolve), timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function cleanText(value: string, max: number): string {
  // Strip markup before decoding, so escaped text such as &lt;b&gt; survives as plain text.
  const stripped = decodeEntities(value.replace(/<[^>]*>/g, ' ')).replace(/[\u0000-\u001f\u007f]/g, ' ');
  return stripped.replace(/\s+/g, ' ').trim().slice(0, max);
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes[(match[1] ?? '').toLowerCase()] = match[2] ?? match[3] ?? '';
  }
  return attributes;
}

export function extractMetadata(html: string): LinkMetadata {
  const head = html.slice(0, MAX_BYTES);
  const meta: Record<string, string> = {};
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const attributes = parseAttributes(tag);
    const key = (attributes.property ?? attributes.name ?? '').toLowerCase();
    if (key && attributes.content !== undefined && !(key in meta)) meta[key] = attributes.content;
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? '';
  return {
    title: cleanText(meta['og:title'] ?? meta['twitter:title'] ?? titleTag, 120),
    description: cleanText(meta['og:description'] ?? meta['description'] ?? meta['twitter:description'] ?? '', 300),
  };
}
