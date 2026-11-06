import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { Config } from '../config.js';
import type { DB } from '../db/index.js';
import { randomId } from './ids.js';

export type ImageFailure = 'too_large' | 'unsupported_type' | 'invalid_image';

export class ImageError extends Error {
  constructor(public readonly code: ImageFailure) {
    super(code);
  }
}

export interface UploadRow {
  id: string;
  user_id: string;
  filename: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  created_at: number;
}

const MAX_DIMENSION = 1600;
const MAX_INPUT_PIXELS = 50_000_000;

function magic(buffer: Buffer): 'jpeg' | 'png' | 'gif' | 'webp' | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }
  if (buffer.length >= 6) {
    const header = buffer.subarray(0, 6).toString('latin1');
    if (header === 'GIF87a' || header === 'GIF89a') return 'gif';
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'webp';
  }
  return null;
}

/**
 * Decode, downscale, re-encode as WebP and strip metadata. SVG is never accepted:
 * only magic bytes for raster formats pass, regardless of filename or declared MIME type.
 */
export async function processImage(buffer: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  if (!magic(buffer)) throw new ImageError('unsupported_type');
  try {
    const { data, info } = await sharp(buffer, {
      limitInputPixels: MAX_INPUT_PIXELS,
      animated: false,
      failOn: 'error',
    })
      .rotate()
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toBuffer({ resolveWithObject: true });

    if (!info.width || !info.height) throw new ImageError('invalid_image');
    return { data, width: info.width, height: info.height };
  } catch (error) {
    if (error instanceof ImageError) throw error;
    throw new ImageError('invalid_image');
  }
}

export async function storeImage(
  db: DB,
  config: Config,
  userId: string,
  file: File,
): Promise<UploadRow> {
  if (file.size > config.maxUploadBytes) throw new ImageError('too_large');
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength > config.maxUploadBytes) throw new ImageError('too_large');
  if (buffer.byteLength === 0) throw new ImageError('invalid_image');

  const processed = await processImage(buffer);
  const id = randomId(16);
  const filename = `${id}.webp`;
  const destination = path.join(config.uploadsDir, filename);
  const temporary = `${destination}.tmp`;

  await fs.mkdir(config.uploadsDir, { recursive: true, mode: 0o700 });
  try {
    await fs.writeFile(temporary, processed.data, { mode: 0o600 });
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }

  const row: UploadRow = {
    id,
    user_id: userId,
    filename,
    mime: 'image/webp',
    bytes: processed.data.byteLength,
    width: processed.width,
    height: processed.height,
    created_at: Date.now(),
  };
  try {
    db.prepare(
      'INSERT INTO uploads (id, user_id, filename, mime, bytes, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(row.id, row.user_id, row.filename, row.mime, row.bytes, row.width, row.height, row.created_at);
  } catch (error) {
    await fs.rm(destination, { force: true }).catch(() => {});
    throw error;
  }
  return row;
}

export function getUpload(db: DB, id: string): UploadRow | null {
  return (db.prepare('SELECT * FROM uploads WHERE id = ?').get(id) as UploadRow | undefined) ?? null;
}

export function canViewUpload(db: DB, userId: string, upload: UploadRow): boolean {
  if (upload.user_id === userId) return true;
  // The item owner can always see their own image, even on a shared list.
  const ownItem = db
    .prepare('SELECT 1 AS ok FROM items WHERE image_upload_id = ? AND user_id = ? LIMIT 1')
    .get(upload.id, userId);
  if (ownItem) return true;
  // Group members may see images of lists shared to one of their groups.
  const sharedItem = db
    .prepare(
      `SELECT 1 AS ok
         FROM items i
         JOIN list_groups lg ON lg.list_id = i.list_id
         JOIN group_members gm ON gm.group_id = lg.group_id
        WHERE i.image_upload_id = ? AND gm.user_id = ?
        LIMIT 1`,
    )
    .get(upload.id, userId);
  return Boolean(sharedItem);
}

/** Public links are scoped to exactly one list and never expose other uploads. */
export function canViewUploadForToken(db: DB, token: string, upload: UploadRow): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1 AS ok
           FROM items i
           JOIN lists l ON l.id = i.list_id
          WHERE i.image_upload_id = ? AND l.public_token = ?
          LIMIT 1`,
      )
      .get(upload.id, token),
  );
}

export function uploadReferenceCount(db: DB, uploadId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM items WHERE image_upload_id = ?').get(uploadId) as {
    count: number;
  };
  return row.count;
}

export async function deleteUploadIfUnused(db: DB, config: Config, uploadId: string): Promise<void> {
  if (uploadReferenceCount(db, uploadId) > 0) return;
  const upload = getUpload(db, uploadId);
  if (!upload) return;
  db.prepare('DELETE FROM uploads WHERE id = ?').run(upload.id);
  await fs.rm(path.join(config.uploadsDir, upload.filename), { force: true }).catch(() => {});
}

export async function deleteUploadFile(config: Config, upload: UploadRow): Promise<void> {
  await fs.rm(path.join(config.uploadsDir, upload.filename), { force: true }).catch(() => {});
}
