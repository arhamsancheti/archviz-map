/**
 * The app, and the admin API behind it.
 *
 *   node serve.mjs        ->  http://localhost:5173        the map
 *                             http://localhost:5173/admin  add and place projects
 *
 * Static serving needs nothing installed. The two admin jobs that do real work -
 * optimising an uploaded .glb into the three streamed builds, and resizing uploaded
 * photos - use the packages in devDependencies (`npm install`), and say so clearly
 * if they are missing rather than failing halfway.
 *
 * This binds to localhost and has no auth, because it is a local authoring tool: the
 * person who can reach it is the person sitting at the machine. Putting it on a
 * network means putting a real login in front of it first.
 */
import { createServer } from 'node:http';
import { readFile, writeFile, stat, mkdir, rm, rename, readdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join, extname, normalize, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT) || 5173;
const host = process.env.HOST || '127.0.0.1';

const REGISTRY = join(root, 'data', 'projects.json');
const MODELS_DIR = join(root, 'models');
const MEDIA_DIR = join(root, 'media');
const UPLOADS_DIR = join(root, 'uploads');

/** A 1 GB export is exactly the case the optimiser exists for, so allow it. */
const MAX_MODEL_BYTES = 1500 * 1024 * 1024;
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
const MODEL_EXT = new Set(['.glb', '.gltf']);

export const IMAGE_CATEGORIES = ['exterior', 'amenities', 'interiors', 'towers', 'plans'];

/* ------------------------------------------------------------------ registry */

/**
 * Every write is read-modify-write on one JSON file, so they have to queue. A promise
 * chain is the whole lock: each mutation waits for the previous one to finish.
 */
let writeQueue = Promise.resolve();

const readRegistry = async () => JSON.parse(await readFile(REGISTRY, 'utf8'));

/** Write through a temp file so a crash mid-write cannot leave a truncated registry. */
async function writeRegistry(registry) {
  const tmp = REGISTRY + '.tmp';
  await writeFile(tmp, JSON.stringify(registry, null, 2));
  await rename(tmp, REGISTRY);
}

function mutate(fn) {
  const next = writeQueue.then(async () => {
    const registry = await readRegistry();
    const result = await fn(registry);
    registry.generated = new Date().toISOString();
    await writeRegistry(registry);
    return result;
  });
  // keep the chain alive even if this mutation threw
  writeQueue = next.catch(() => {});
  return next;
}

/** Deep-merge plain objects; arrays and scalars replace outright. */
function merge(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) &&
        target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      merge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

/* ---------------------------------------------------------------------- jobs */

/** Long-running work the browser polls. In memory - a restart loses the log, not the output. */
const jobs = new Map();

function startJob(label, run) {
  const id = randomUUID();
  const job = { id, label, status: 'running', log: [], result: null, error: null, startedAt: Date.now() };
  jobs.set(id, job);
  const say = (line) => {
    job.log.push(line);
    console.log(`  [${label}] ${line}`);
  };
  run(say)
    .then((result) => {
      job.result = result;
      job.status = 'done';
    })
    .catch((err) => {
      job.error = err.message;
      job.status = 'failed';
      say('failed: ' + err.message);
    })
    .finally(() => {
      job.finishedAt = Date.now();
      // a finished job is only useful while the tab that started it is looking
      setTimeout(() => jobs.delete(id), 10 * 60 * 1000).unref?.();
    });
  return job;
}

/* -------------------------------------------------------------------- upload */

/** Stream a request body to disk, refusing anything over the cap. */
async function receiveFile(req, destPath, maxBytes) {
  await mkdir(join(destPath, '..'), { recursive: true });
  let received = 0;
  req.on('data', (chunk) => {
    received += chunk.length;
    if (received > maxBytes) req.destroy(new Error('file is larger than the limit'));
  });
  await pipeline(req, createWriteStream(destPath));
  if (received === 0) throw new Error('empty upload');
  return received;
}

const safeSegment = (s) => String(s || '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80);

/* ----------------------------------------------------------------- responses */

const json = (res, code, body) => {
  const text = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
};

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new Error('body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/* --------------------------------------------------------------------- media */

/**
 * Store one uploaded photo. With sharp available it is resized to a display copy and
 * a thumbnail, both WebP - a 12 MB camera JPEG becomes about 200 KB, which matters
 * because these load in the detail panel while a 3D model is streaming behind them.
 * Without sharp the original is kept and used for both, which still works.
 */
async function storeImage({ projectId, tmpPath, ext, category, caption }) {
  const id = randomUUID().slice(0, 8);
  const dir = join(MEDIA_DIR, projectId);
  await mkdir(dir, { recursive: true });

  let sharp = null;
  try {
    sharp = (await import('sharp')).default;
  } catch { /* keep the original */ }

  let record;
  if (sharp) {
    const image = sharp(tmpPath, { failOn: 'none' });
    const meta = await image.metadata();
    const fullName = id + '.webp';
    const thumbName = id + '.thumb.webp';
    await sharp(tmpPath).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 }).toFile(join(dir, fullName));
    await sharp(tmpPath).rotate().resize({ width: 480, height: 480, fit: 'cover' })
      .webp({ quality: 74 }).toFile(join(dir, thumbName));
    const size = await stat(join(dir, fullName));
    record = {
      id,
      url: `media/${projectId}/${fullName}`,
      thumb: `media/${projectId}/${thumbName}`,
      width: meta.width || null,
      height: meta.height || null,
      bytes: size.size,
    };
    await rm(tmpPath, { force: true });
  } else {
    const name = id + ext;
    await rename(tmpPath, join(dir, name));
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

/* ----------------------------------------------------------------------- api */

async function handleApi(req, res, url) {
  const path = url.pathname.replace(/^\/api\//, '');
  const parts = path.split('/').filter(Boolean);
  const { makeProject, slugify, hashSeed } = await import('./tools/registry-lib.mjs');

  // GET /api/registry
  if (req.method === 'GET' && parts[0] === 'registry') {
    return json(res, 200, await readRegistry());
  }

  // GET /api/meta - what the admin form needs to draw itself
  if (req.method === 'GET' && parts[0] === 'meta') {
    const registry = await readRegistry();
    return json(res, 200, {
      imageCategories: IMAGE_CATEGORIES,
      statuses: ['Ready to Move', 'Under Construction', 'New Launch'],
      cities: [...new Set(registry.projects.map((p) => p.city))].sort(),
      developers: [...new Set(registry.projects.map((p) => p.developer))].sort(),
      tooling: await toolingStatus(),
    });
  }

  // GET /api/jobs/:id
  if (req.method === 'GET' && parts[0] === 'jobs' && parts[1]) {
    const job = jobs.get(parts[1]);
    if (!job) return json(res, 404, { error: 'no such job' });
    return json(res, 200, job);
  }

  // POST /api/projects
  if (req.method === 'POST' && parts[0] === 'projects' && !parts[1]) {
    const body = await readJson(req);
    if (!body.name) return json(res, 400, { error: 'name is required' });
    if (!Number.isFinite(Number(body.lng)) || !Number.isFinite(Number(body.lat))) {
      return json(res, 400, { error: 'lng and lat are required' });
    }
    const created = await mutate(async (registry) => {
      const id = slugify(body.id || body.name, registry.projects.map((p) => p.id));
      const project = makeProject({ ...body, id, seed: body.seed || hashSeed(id) });
      registry.projects.push(project);
      return project;
    });
    return json(res, 201, created);
  }

  // PATCH /api/projects/:id
  if (req.method === 'PATCH' && parts[0] === 'projects' && parts[1] && !parts[2]) {
    const body = await readJson(req);
    const updated = await mutate(async (registry) => {
      const project = registry.projects.find((p) => p.id === parts[1]);
      if (!project) return null;
      // The identity fields are the ones a rebuild is keyed on, so they are patched
      // as a whole project rather than merged into the generated output.
      if (body.rebuild) {
        const i = registry.projects.indexOf(project);
        const rebuilt = makeProject({
          ...body.rebuild,
          id: project.id,
          seed: project.seed,
          asset: project.plan.asset,
          images: project.images || [],
        });
        registry.projects[i] = rebuilt;
        return rebuilt;
      }
      delete body.id;
      merge(project, body);
      return project;
    });
    if (!updated) return json(res, 404, { error: 'no such project' });
    return json(res, 200, updated);
  }

  // DELETE /api/projects/:id
  if (req.method === 'DELETE' && parts[0] === 'projects' && parts[1] && !parts[2]) {
    const id = safeSegment(parts[1]);
    const removed = await mutate(async (registry) => {
      const i = registry.projects.findIndex((p) => p.id === parts[1]);
      if (i < 0) return null;
      return registry.projects.splice(i, 1)[0];
    });
    if (!removed) return json(res, 404, { error: 'no such project' });
    await rm(join(MODELS_DIR, id), { recursive: true, force: true });
    await rm(join(MEDIA_DIR, id), { recursive: true, force: true });
    await rm(join(UPLOADS_DIR, id), { recursive: true, force: true });
    return json(res, 200, { ok: true });
  }

  // PUT /api/projects/:id/model?filename=export.glb
  if (req.method === 'PUT' && parts[0] === 'projects' && parts[1] && parts[2] === 'model') {
    const id = safeSegment(parts[1]);
    const registry = await readRegistry();
    if (!registry.projects.some((p) => p.id === id)) return json(res, 404, { error: 'no such project' });

    const ext = extname(url.searchParams.get('filename') || '.glb').toLowerCase();
    if (!MODEL_EXT.has(ext)) return json(res, 400, { error: 'expected a .glb or .gltf file' });

    const sourcePath = join(UPLOADS_DIR, id, 'source' + ext);
    let bytes;
    try {
      bytes = await receiveFile(req, sourcePath, MAX_MODEL_BYTES);
    } catch (err) {
      return json(res, 413, { error: err.message });
    }

    const job = startJob('optimize ' + id, async (say) => {
      const { buildLods } = await import('./tools/optimize.mjs');
      const result = await buildLods({
        input: sourcePath,
        outDir: join(MODELS_DIR, id),
        urlBase: 'models/' + id,
        onLog: say,
      });
      // keep whatever placement the project already had - re-uploading a corrected
      // export should not throw away an alignment someone spent time on
      await mutate(async (reg) => {
        const project = reg.projects.find((p) => p.id === id);
        if (!project) return;
        const previous = project.plan.asset || {};
        project.plan.asset = {
          ...result.asset,
          scale: previous.scale ?? result.asset.scale,
          heading: previous.heading ?? result.asset.heading,
          offset: previous.offset ?? result.asset.offset,
          autoGround: previous.autoGround ?? result.asset.autoGround,
        };
        // the site plate, the massing footprint and the screen-size cull all read
        // plan.site, so it has to describe the real building now, not a guess
        if (result.bounds) {
          const scale = project.plan.asset.scale || 1;
          const span = Math.max(result.bounds.size[0], result.bounds.size[2]) * scale;
          project.plan.site.w = Math.round(Math.max(40, span * 1.35));
          project.plan.site.d = Math.round(Math.max(40, span * 1.35));
        }
        project.plan.modelBounds = result.bounds
          ? { span: result.bounds.span, height: result.bounds.height, centre: result.bounds.centre }
          : null;
      });
      say('registry updated');
      return result;
    });

    return json(res, 202, { jobId: job.id, uploadedBytes: bytes });
  }

  // POST /api/projects/:id/images?filename=x.jpg&category=amenities&caption=...
  if (req.method === 'POST' && parts[0] === 'projects' && parts[1] && parts[2] === 'images' && !parts[3]) {
    const id = safeSegment(parts[1]);
    const registry = await readRegistry();
    if (!registry.projects.some((p) => p.id === id)) return json(res, 404, { error: 'no such project' });

    const ext = extname(url.searchParams.get('filename') || '.jpg').toLowerCase();
    if (!IMAGE_EXT.has(ext)) return json(res, 400, { error: 'expected a jpg, png, webp or avif' });

    const tmpPath = join(UPLOADS_DIR, id, randomUUID().slice(0, 8) + ext);
    try {
      await receiveFile(req, tmpPath, MAX_IMAGE_BYTES);
    } catch (err) {
      return json(res, 413, { error: err.message });
    }

    let record;
    try {
      record = await storeImage({
        projectId: id,
        tmpPath,
        ext,
        category: url.searchParams.get('category'),
        caption: url.searchParams.get('caption'),
      });
    } catch (err) {
      await rm(tmpPath, { force: true });
      return json(res, 400, { error: 'could not read that image: ' + err.message });
    }

    await mutate(async (reg) => {
      const project = reg.projects.find((p) => p.id === id);
      if (!project) return;
      project.images = project.images || [];
      project.images.push(record);
    });
    return json(res, 201, record);
  }

  // DELETE /api/projects/:id/images/:imageId
  if (req.method === 'DELETE' && parts[0] === 'projects' && parts[2] === 'images' && parts[3]) {
    const id = safeSegment(parts[1]);
    const imageId = safeSegment(parts[3]);
    const removed = await mutate(async (registry) => {
      const project = registry.projects.find((p) => p.id === id);
      if (!project || !project.images) return null;
      const i = project.images.findIndex((im) => im.id === imageId);
      if (i < 0) return null;
      return project.images.splice(i, 1)[0];
    });
    if (!removed) return json(res, 404, { error: 'no such image' });
    for (const file of [removed.url, removed.thumb]) {
      if (file) await rm(join(root, file), { force: true });
    }
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'unknown endpoint' });
}

/** Which optional pieces of the pipeline are actually installed. */
async function toolingStatus() {
  const has = async (name) => {
    try {
      await import(name);
      return true;
    } catch {
      return false;
    }
  };
  return {
    gltfTransform: await has('@gltf-transform/core'),
    sharp: await has('sharp'),
  };
}

/* -------------------------------------------------------------------- static */

async function serveStatic(req, res, url) {
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  if (path === 'admin') path = 'admin.html';
  if (path === '' || path.endsWith('/')) path += 'index.html';
  const file = join(root, path);
  if (!file.startsWith(root)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  const info = await stat(file);
  const target = info.isDirectory() ? join(file, 'index.html') : file;
  const body = await readFile(target);
  res.writeHead(200, {
    'content-type': MIME[extname(target)] || 'application/octet-stream',
    // Uploaded models and photos are content-addressed by a random id, so they can
    // be cached hard; everything else is source you are editing.
    'cache-control': /^(media|models)\//.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(body);
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (err) {
    if (url.pathname.startsWith('/api/')) {
      json(res, 500, { error: err.message });
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
}).listen(port, host, async () => {
  await mkdir(UPLOADS_DIR, { recursive: true });
  await mkdir(MEDIA_DIR, { recursive: true });
  console.log(`VU map    http://${host}:${port}`);
  console.log(`VU admin  http://${host}:${port}/admin`);
  const tooling = await toolingStatus();
  if (!tooling.gltfTransform) {
    console.log('\n  note: `npm install` first if you want to upload models - the optimiser needs it.');
  } else if (!tooling.sharp) {
    console.log('\n  note: sharp is not installed, so uploaded photos and textures keep their original size.');
  }
});
