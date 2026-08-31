/**
 * Storing a project photo, once, for both callers.
 *
 * The admin upload in `serve.mjs` and the demo-image generator both land here, so a
 * picture that arrived by drag-and-drop and a picture that was generated are the same
 * two files on disk with the same record in the registry.
 *
 * Two derivatives, both WebP: a 1600px display copy and a 480px square thumbnail. A
 * 12 MB camera JPEG becomes about 200 KB, which matters because these load in the
 * detail panel while a 3D model is streaming behind them.
 *
 * Without `sharp` the original is kept and used for both. That still works - it is
 * just heavier - so a missing optional dependency degrades the result rather than
 * failing the upload.
 */
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const IMAGE_CATEGORIES = ['exterior', 'amenities', 'interiors', 'towers', 'plans'];

export const DISPLAY_PX = 1600;
export const THUMB_PX = 480;

async function loadSharp() {
  try {
    return (await import('sharp')).default;
  } catch {
    return null;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.mediaDir   root media directory
 * @param {string} opts.projectId
 * @param {string} [opts.tmpPath]  a file on disk to consume (moved or deleted)
 * @param {Buffer} [opts.buffer]   image bytes, as an alternative to tmpPath
 * @param {string} opts.ext        original extension, used only in the fallback path
 */
export async function storeImage({ mediaDir, projectId, tmpPath, buffer, ext = '.jpg', category, caption }) {
  const id = randomUUID().slice(0, 8);
  const dir = join(mediaDir, projectId);
  await mkdir(dir, { recursive: true });

  const sharp = await loadSharp();
  const source = buffer || tmpPath;
  let record;

  if (sharp) {
    const meta = await sharp(source, { failOn: 'none' }).metadata();
    const full = id + '.webp';
    const thumb = id + '.thumb.webp';
    await sharp(source).rotate()
      .resize({ width: DISPLAY_PX, height: DISPLAY_PX, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 }).toFile(join(dir, full));
    await sharp(source).rotate()
      .resize({ width: THUMB_PX, height: THUMB_PX, fit: 'cover' })
      .webp({ quality: 74 }).toFile(join(dir, thumb));
    const size = await stat(join(dir, full));
    record = {
      id,
      url: `media/${projectId}/${full}`,
      thumb: `media/${projectId}/${thumb}`,
      width: meta.width || null,
      height: meta.height || null,
      bytes: size.size,
    };
    if (tmpPath) await rm(tmpPath, { force: true });
  } else {
    const name = id + ext;
    if (buffer) await writeFile(join(dir, name), buffer);
    else await rename(tmpPath, join(dir, name));
    const size = await stat(join(dir, name));
    record = {
      id,
      url: `media/${projectId}/${name}`,
      thumb: `media/${projectId}/${name}`,
      width: null,
      height: null,
      bytes: size.size,
    };
  }

  record.category = IMAGE_CATEGORIES.includes(category) ? category : 'exterior';
  record.caption = String(caption || '').slice(0, 160);
  return record;
}
