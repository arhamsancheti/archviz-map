/**
 * The authoring side: add a project, give it a model, drag the model onto its plot,
 * and give it photos.
 *
 * The placement editor deliberately reuses the map app's own SceneManager and
 * loadProject rather than a simplified preview. What you align here is drawn by the
 * exact code that will draw it on the map, on the same terrain, so "it looked right
 * in the editor" and "it looks right in the product" cannot come apart.
 */
import { BASEMAP, WORLD, PERF } from './config.js';
import { SceneManager } from './scene.js';
import { loadProject, placeAsset } from './buildings.js';
import { siteFeature } from './geo.js';

const $ = (sel, host = document) => host.querySelector(sel);
const $$ = (sel, host = document) => [...host.querySelectorAll(sel)];

const state = {
  projects: [],
  meta: null,
  selectedId: null,
  tab: 'details',
};

boot();

async function boot() {
  await refresh();
  state.meta = await api('GET', '/api/meta');
  paintTooling();
  $('#btn-new').onclick = newProject;
  render();
}

async function refresh() {
  const registry = await api('GET', '/api/registry');
  state.projects = registry.projects;
}

const selected = () => state.projects.find((p) => p.id === state.selectedId) || null;

/* ------------------------------------------------------------------- fetch */

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

/** Raw-body upload. The server streams it straight to disk, so size is not a problem. */
async function upload(path, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* non-JSON error page */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || 'upload failed (' + xhr.status + ')'));
    };
    xhr.onerror = () => reject(new Error('upload failed'));
    xhr.send(file);
  });
}

function uploadPut(path, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', path);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* non-JSON error page */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || 'upload failed (' + xhr.status + ')'));
    };
    xhr.onerror = () => reject(new Error('upload failed'));
    xhr.send(file);
  });
}

/* -------------------------------------------------------------------- chrome */

function paintTooling() {
  const t = state.meta.tooling;
  const host = $('#tooling');
  if (!t.gltfTransform) {
    host.innerHTML = `<span class="warn-pill">Run npm install to upload models</span>`;
  } else if (!t.sharp) {
    host.innerHTML = `<span class="warn-pill">sharp missing - photos and textures keep their original size</span>`;
  } else {
    host.innerHTML = `<b>Pipeline ready</b>`;
  }
}

function render() {
  paintList();
  paintMain();
}

function paintList() {
  const host = $('#admin-list');
  host.textContent = '';
  for (const p of state.projects) {
    const hasModel = !!(p.plan.asset && p.plan.asset.lods);
    const hasPhotos = !!(p.images && p.images.length);
    const b = document.createElement('button');
    b.className = 'admin-item';
    b.setAttribute('aria-current', String(p.id === state.selectedId));
    b.innerHTML = `
      <span class="swatch" style="background:linear-gradient(150deg, ${p.accent}, ${shade(p.accent, -40)})"></span>
      <span><b>${esc(p.name)}</b><small>${esc(p.locality)}, ${esc(p.city)}</small></span>
      <span class="marks">
        <i class="mark-dot ${hasModel ? 'on' : ''}" title="${hasModel ? 'Model uploaded' : 'No model yet'}"></i>
        <i class="mark-dot ${hasPhotos ? 'on' : ''}" title="${hasPhotos ? p.images.length + ' photos' : 'No photos yet'}"></i>
      </span>`;
    b.onclick = () => {
      state.selectedId = p.id;
      state.tab = 'details';
      render();
    };
    host.appendChild(b);
  }
}

function paintMain() {
  const host = $('#admin-main');
  teardownPlacement();
  const p = selected();

  if (!p) {
    host.innerHTML = `
      <div class="admin-empty">
        <h2>Nothing selected</h2>
        <p>Pick a project on the left to edit it, upload its model and drag it onto its
        plot &mdash; or start a new one. Everything you save here is written straight
        into <code>data/projects.json</code>, which is what the map reads.</p>
      </div>`;
    return;
  }

  host.innerHTML = `
    <div class="editor-head">
      <div>
        <h1>${esc(p.name)}</h1>
        <p>${esc(p.developer)} &middot; ${esc(p.locality)}, ${esc(p.city)} &middot; <code>${esc(p.id)}</code></p>
      </div>
      <div class="spacer"></div>
      <a class="btn ghost" href="/?p=${encodeURIComponent(p.id)}" target="_blank" rel="noopener">See it on the map</a>
      <button class="btn ghost" id="btn-delete" title="Delete this project" aria-label="Delete this project">
        <svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/></svg>
      </button>
    </div>

    <nav class="admin-tabs" role="tablist">
      <button data-tab="details" role="tab">Details</button>
      <button data-tab="model" role="tab">Model &amp; placement</button>
      <button data-tab="photos" role="tab">Photos${p.images && p.images.length ? ' (' + p.images.length + ')' : ''}</button>
    </nav>
    <div id="editor-body"></div>`;

  $('#btn-delete').onclick = () => deleteProject(p);
  for (const b of $$('.admin-tabs button')) {
    b.setAttribute('aria-selected', String(b.dataset.tab === state.tab));
    b.onclick = () => {
      state.tab = b.dataset.tab;
      paintMain();
    };
  }

  if (state.tab === 'details') paintDetails(p);
  else if (state.tab === 'model') paintModel(p);
  else paintPhotos(p);
}

/* ------------------------------------------------------------------ details */

const FIELDS = [
  ['name', 'Name', 'text'],
  ['developer', 'Developer', 'text'],
  ['city', 'City', 'text'],
  ['locality', 'Locality', 'text'],
  ['status', 'Status', 'select'],
  ['possession', 'Possession', 'text', 'e.g. Dec 2027, or "Handed over"'],
  ['priceFrom', 'Starting price (₹)', 'number'],
  ['sizeRange', 'Size range', 'text', 'e.g. 900 - 1,800 sq.ft.'],
  ['unitTypes', 'Configurations', 'text', 'comma separated, e.g. 2 BHK, 3 BHK'],
  ['acres', 'Land area (acres)', 'number'],
  ['towers', 'Towers', 'number'],
  ['units', 'Residences', 'number'],
  ['floorsMin', 'Floors from', 'number'],
  ['floorsMax', 'Floors to', 'number'],
  ['openSpace', 'Open space (%)', 'number'],
  ['rera', 'RERA', 'text'],
  ['accent', 'Accent colour', 'color'],
];

/** The registry entry, back in the shape the form edits. */
function toForm(p) {
  return {
    name: p.name,
    developer: p.developer,
    city: p.city,
    locality: p.locality,
    status: p.status,
    possession: p.facts.possession,
    priceFrom: p.price.from,
    sizeRange: p.facts.sizeRange,
    unitTypes: p.facts.unitTypes.join(', '),
    acres: p.facts.acres,
    towers: p.facts.towers,
    units: p.facts.units,
    floorsMin: Math.max(1, Math.round(p.facts.floorsMax * 0.7)),
    floorsMax: p.facts.floorsMax,
    openSpace: p.facts.openSpacePct,
    rera: p.facts.rera,
    accent: p.accent,
    tagline: p.tagline,
    lng: p.location.lng,
    lat: p.location.lat,
  };
}

function paintDetails(p) {
  const v = toForm(p);
  $('#editor-body').innerHTML = `
    <div class="pane">
      <h3>The project</h3>
      <p class="hint">Saving rebuilds the generated parts &mdash; unit mix, nearby places,
        the specification and the master plan &mdash; from these numbers. The plan is
        seeded on the project id, so re-saving never reshuffles the site.</p>
      <div class="grid">
        ${FIELDS.map((f) => field(f, v)).join('')}
      </div>
      <div class="grid wide" style="margin-top:12px">
        <label class="field"><span>Tagline</span>
          <textarea name="tagline">${esc(v.tagline || '')}</textarea></label>
      </div>
      <div class="form-foot">
        <button class="btn primary" id="save-details" style="flex:none">Save</button>
        <span class="msg" id="details-msg"></span>
      </div>
    </div>

    <div class="pane">
      <h3>Where it is</h3>
      <p class="hint">The pin the model is placed against. Drag it on the map in
        <b>Model &amp; placement</b>, or type coordinates here.</p>
      <div class="grid">
        <label class="field"><span>Longitude</span><input name="lng" type="number" step="0.000001" value="${v.lng}" /></label>
        <label class="field"><span>Latitude</span><input name="lat" type="number" step="0.000001" value="${v.lat}" /></label>
      </div>
      <div class="form-foot">
        <button class="btn primary" id="save-location" style="flex:none">Save location</button>
        <span class="msg" id="location-msg"></span>
      </div>
    </div>`;

  $('#save-details').onclick = async () => {
    const form = readForm();
    const msg = $('#details-msg');
    msg.className = 'msg';
    msg.textContent = 'Saving...';
    try {
      await api('PATCH', '/api/projects/' + p.id, {
        rebuild: {
          ...form,
          unitTypes: String(form.unitTypes).split(',').map((s) => s.trim()).filter(Boolean),
          floors: [Number(form.floorsMin), Number(form.floorsMax)],
          lng: Number(form.lng ?? p.location.lng),
          lat: Number(form.lat ?? p.location.lat),
        },
      });
      await refresh();
      msg.className = 'msg ok';
      msg.textContent = 'Saved';
      render();
    } catch (err) {
      msg.className = 'msg bad';
      msg.textContent = err.message;
    }
  };

  $('#save-location').onclick = async () => {
    const msg = $('#location-msg');
    msg.className = 'msg';
    msg.textContent = 'Saving...';
    try {
      await api('PATCH', '/api/projects/' + p.id, {
        location: { lng: Number($('[name=lng]').value), lat: Number($('[name=lat]').value) },
      });
      await refresh();
      msg.className = 'msg ok';
      msg.textContent = 'Saved';
    } catch (err) {
      msg.className = 'msg bad';
      msg.textContent = err.message;
    }
  };
}

function field([name, label, type, hint], values) {
  const value = values[name] ?? '';
  if (type === 'select') {
    return `<label class="field"><span>${label}</span>
      <select name="${name}">${state.meta.statuses
        .map((s) => `<option ${s === value ? 'selected' : ''}>${esc(s)}</option>`)
        .join('')}</select>${hint ? `<small>${hint}</small>` : ''}</label>`;
  }
  return `<label class="field"><span>${label}</span>
    <input name="${name}" type="${type}" value="${esc(String(value))}" />${hint ? `<small>${esc(hint)}</small>` : ''}</label>`;
}

function readForm(host = document) {
  const out = {};
  for (const el of $$('[name]', host)) {
    out[el.name] = el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value;
  }
  return out;
}

/* -------------------------------------------------------------------- model */

function paintModel(p) {
  const asset = p.plan.asset || {};
  const hasModel = !!asset.lods;

  $('#editor-body').innerHTML = `
    ${hasModel ? '' : `<div class="pane">
      <h3>The model</h3>
      <p class="hint">Drop the export straight in &mdash; a 1 GB file is exactly what this
        is for. It is optimised into the three builds the map streams: full detail up
        close, a lighter one on approach, a tiny one for "there is a building there".</p>
      <div class="drop" id="model-drop">
        <svg viewBox="0 0 24 24"><path d="M12 16V4"/><path d="M8 8l4-4 4 4"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
        <b>Drop a .glb or .gltf</b>
        <span>or click to choose a file</span>
      </div>
      <div id="model-progress"></div>
    </div>`}

    ${hasModel ? `<div class="pane">
      <h3>Streamed builds</h3>
      <div class="report">
        ${['high', 'mid', 'low'].map((lvl) => asset.lods[lvl] ? `<div>
          <b>${kb(asset.lods[lvl].bytes)}</b><span>${lvl}</span></div>` : '').join('')}
        ${p.plan.modelBounds ? `<div><b>${p.plan.modelBounds.span.toFixed(0)} m</b><span>across</span></div>
          <div><b>${p.plan.modelBounds.height.toFixed(0)} m</b><span>tall</span></div>` : ''}
      </div>
      <div class="form-foot">
        <button class="btn ghost" id="model-replace" style="flex:none">Replace the model</button>
        <span class="msg">Replacing keeps the placement below.</span>
      </div>
      <div id="model-progress"></div>
    </div>` : ''}

    ${hasModel ? `<div class="pane">
      <h3>Placement</h3>
      <p class="hint">Drag the blue handle to move it, then set which way it faces and how
        big it is. This is the map's own renderer on the real terrain, so what you see
        here is what the product draws.</p>
      <div id="place-warning"></div>
      <div class="place">
        <div id="place-map"></div>
        <div class="place-controls" id="place-controls"></div>
      </div>
    </div>` : ''}`;

  wireModelDrop(p);
  if (hasModel) setupPlacement(p);
}

function wireModelDrop(p) {
  const drop = $('#model-drop');
  const replace = $('#model-replace');
  const pick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.glb,.gltf';
    input.onchange = () => input.files[0] && sendModel(p, input.files[0]);
    input.click();
  };
  if (replace) replace.onclick = pick;
  if (!drop) return;
  drop.onclick = pick;
  drop.ondragover = (e) => {
    e.preventDefault();
    drop.classList.add('over');
  };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const file = e.dataTransfer.files[0];
    if (file) sendModel(p, file);
  };
}

async function sendModel(p, file) {
  const host = $('#model-progress');
  host.innerHTML = `<div class="joblog" id="job-log">uploading ${esc(file.name)} (${mb(file.size)})...</div>`;
  const log = $('#job-log');
  const append = (line, cls = '') => {
    log.insertAdjacentHTML('beforeend', `\n<span class="${cls}">${esc(line)}</span>`);
    log.scrollTop = log.scrollHeight;
  };

  try {
    const started = await uploadPut(
      `/api/projects/${p.id}/model?filename=${encodeURIComponent(file.name)}`,
      file,
      (frac) => { log.firstChild.textContent = `uploading ${file.name} (${mb(file.size)}) - ${Math.round(frac * 100)}%`; }
    );
    append('uploaded, optimising...');
    const job = await followJob(started.jobId, append);
    if (job.status === 'failed') {
      append(job.error, 'bad');
      return;
    }
    append('done', 'good');
    if (job.result && job.result.warning) {
      append(`heads up: the model measures ${job.result.bounds.span.toFixed(1)} units across, which ${job.result.warning.why}.`, 'bad');
    }
    await refresh();
    render();
  } catch (err) {
    append(err.message, 'bad');
  }
}

/** Poll a job until it stops running, streaming new log lines as they appear. */
async function followJob(jobId, append) {
  let seen = 0;
  for (;;) {
    const job = await api('GET', '/api/jobs/' + jobId);
    for (; seen < job.log.length; seen++) append(job.log[seen]);
    if (job.status !== 'running') return job;
    await new Promise((r) => setTimeout(r, 600));
  }
}

/* ---------------------------------------------------------------- placement */

let place = null; // { map, scene, model, marker, asset, project }
// same debug hook the map app exposes, so the placement editor can be poked at live
Object.defineProperty(window, '__place', { get: () => place });

function teardownPlacement() {
  if (!place) return;
  try { place.map.remove(); } catch { /* already gone */ }
  place = null;
}

function setupPlacement(project) {
  const asset = structuredClone(project.plan.asset);
  const location = { ...project.location };

  const map = new maplibregl.Map({
    container: 'place-map',
    style: BASEMAP.style,
    center: [location.lng, location.lat],
    zoom: 16.4,
    pitch: 55,
    bearing: 0,
    antialias: PERF.antialias,
    attributionControl: { compact: true },
    maxPitch: 78,
  });
  const scene = new SceneManager();
  place = { map, scene, project, asset, location, model: null, dirty: false };

  map.on('style.load', async () => {
    // terrain and the site outline, so the model is judged against the same ground
    // and the same plot boundary the map will show
    try {
      if (!map.getSource(WORLD.dem.id)) map.addSource(WORLD.dem.id, WORLD.dem.spec);
      map.setTerrain({ source: WORLD.dem.id, exaggeration: WORLD.exaggeration });
    } catch { /* terrain unavailable */ }

    map.addSource('site', { type: 'geojson', data: siteFeature({ ...project, location }) });
    map.addLayer({
      id: 'site-fill', type: 'fill', source: 'site',
      paint: { 'fill-color': project.accent, 'fill-opacity': 0.14 },
    });
    map.addLayer({
      id: 'site-line', type: 'line', source: 'site',
      paint: { 'line-color': project.accent, 'line-width': 1.6, 'line-dasharray': [3, 2] },
    });
    map.addLayer(scene.layer());
    await loadPreview();
  });

  // the handle is the model's origin - the point the lng/lat refers to
  const el = document.createElement('div');
  el.className = 'place-marker';
  const marker = new maplibregl.Marker({ element: el, draggable: true })
    .setLngLat([location.lng, location.lat])
    .addTo(map);
  marker.on('drag', () => {
    const ll = marker.getLngLat();
    place.location = { lng: ll.lng, lat: ll.lat };
    scene.setLngLat(project.id, place.location);
    map.getSource('site').setData(siteFeature({ ...project, location: place.location }));
    markDirty();
    updateReadouts();
  });
  place.marker = marker;

  map.on('moveend', () => scene.updateAltitudes());
  map.on('idle', () => scene.updateAltitudes());
  /**
   * Elevation tiles arrive after the camera has settled, and `idle` is not
   * guaranteed - a busy render loop can starve it. Without this the model keeps the
   * altitude it was added with (0) while the terrain under it rises to the real
   * ground, and it disappears into the hill. The map app hooks the same event for
   * the same reason.
   */
  let altTimer = null;
  map.on('sourcedata', (e) => {
    if (e.sourceId !== WORLD.dem.id || altTimer) return;
    altTimer = setTimeout(() => {
      altTimer = null;
      scene.updateAltitudes();
    }, 300);
  });

  paintPlaceControls();
}

async function loadPreview() {
  const { project, asset, location, scene, map } = place;
  if (scene.has(project.id)) scene.remove(project.id);
  const model = await loadProject({ ...project, plan: { ...project.plan, asset } }, 'high', { skirt: 0 });
  place.model = model;
  const radiusM = Math.hypot(project.plan.site.w, project.plan.site.d) / 2;
  scene.add(project.id, model, location, radiusM);
  scene.setShadowFocus(project.id);
  map.triggerRepaint();
}

/** Re-aim the loaded model instead of re-downloading it on every slider tick. */
function reapply() {
  if (!place || !place.model) return;
  placeAsset(place.model.inner, place.asset);
  place.scene.updateAltitudes();
  place.map.triggerRepaint();
}

function markDirty() {
  if (!place) return;
  place.dirty = true;
  const save = $('#place-save');
  if (save) save.disabled = false;
}

const SCALE_PRESETS = [
  [1, 'Metres'],
  [0.01, 'Centimetres'],
  [0.3048, 'Feet'],
  [0.001, 'Millimetres'],
];

function paintPlaceControls() {
  const host = $('#place-controls');
  if (!host || !place) return;
  const { asset, location, project } = place;
  const bounds = project.plan.modelBounds;
  const span = bounds ? bounds.span * (asset.scale || 1) : null;

  host.innerHTML = `
    <h4>Facing</h4>
    <div class="slider">
      <label>Heading <b id="r-heading">${Math.round(asset.heading || 0)}&deg;</b></label>
      <input type="range" id="p-heading" min="0" max="359" step="1" value="${Math.round(asset.heading || 0)}" />
    </div>

    <h4>Size</h4>
    <div class="field">
      <input type="number" id="p-scale" step="0.001" value="${asset.scale ?? 1}" />
    </div>
    <div class="scale-presets">
      ${SCALE_PRESETS.map(([v, label]) =>
        `<button class="chip" data-scale="${v}" aria-pressed="${Number(asset.scale) === v}">${label}</button>`
      ).join('')}
    </div>
    ${span ? `<div class="measure">
      At this scale the model is <b>${span.toFixed(1)} m</b> across and
      <b>${(bounds.height * (asset.scale || 1)).toFixed(1)} m</b> tall.
      ${span > 3000 || span < 6 ? '<br>That does not look like a building - check the units.' : ''}
    </div>` : ''}

    <h4>Nudge (metres)</h4>
    <div class="slider">
      <label>East <b id="r-east">${(asset.offset?.east ?? 0).toFixed(0)} m</b></label>
      <input type="range" id="p-east" min="-200" max="200" step="1" value="${asset.offset?.east ?? 0}" />
    </div>
    <div class="slider">
      <label>South <b id="r-south">${(asset.offset?.south ?? 0).toFixed(0)} m</b></label>
      <input type="range" id="p-south" min="-200" max="200" step="1" value="${asset.offset?.south ?? 0}" />
    </div>
    <div class="slider">
      <label>Up <b id="r-up">${(asset.offset?.up ?? 0).toFixed(1)} m</b></label>
      <input type="range" id="p-up" min="-40" max="40" step="0.5" value="${asset.offset?.up ?? 0}" />
    </div>

    <label class="switch">
      <span>Sit it on the ground<br><small style="color:var(--faint)">drops the model so its lowest point rests on the terrain</small></span>
      <input type="checkbox" id="p-ground" ${asset.autoGround !== false ? 'checked' : ''} />
    </label>

    <div class="measure">
      Pin <b id="r-pin">${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}</b>
    </div>

    <div class="form-foot" style="margin-top:auto">
      <button class="btn primary" id="place-save" style="flex:1" ${place.dirty ? '' : 'disabled'}>Save placement</button>
    </div>
    <span class="msg" id="place-msg" style="font-size:12px;color:var(--muted)"></span>`;

  const bind = (id, apply) => {
    const el = $('#' + id);
    if (!el) return;
    el.oninput = () => {
      apply(el);
      reapply();
      markDirty();
      // repaint only the readouts; rebuilding mid-drag would drop the slider
      updateReadouts();
    };
  };
  bind('p-heading', (el) => { place.asset.heading = Number(el.value); });
  bind('p-east', (el) => { place.asset.offset = { ...place.asset.offset, east: Number(el.value) }; });
  bind('p-south', (el) => { place.asset.offset = { ...place.asset.offset, south: Number(el.value) }; });
  bind('p-up', (el) => { place.asset.offset = { ...place.asset.offset, up: Number(el.value) }; });

  $('#p-scale').onchange = () => {
    place.asset.scale = Number($('#p-scale').value) || 1;
    reapply();
    markDirty();
    paintPlaceControls();
  };
  for (const b of $$('.scale-presets .chip')) {
    b.onclick = () => {
      place.asset.scale = Number(b.dataset.scale);
      reapply();
      markDirty();
      paintPlaceControls();
    };
  }
  $('#p-ground').onchange = () => {
    place.asset.autoGround = $('#p-ground').checked;
    reapply();
    markDirty();
  };
  $('#place-save').onclick = savePlacement;
}

/**
 * Live numbers while a slider is being dragged. Repainting the whole control panel
 * mid-drag would replace the input under the pointer and drop the gesture, so only
 * the readouts are touched.
 */
function updateReadouts() {
  const { asset, location } = place;
  const set = (id, text) => {
    const el = $('#' + id);
    if (el) el.textContent = text;
  };
  set('r-heading', Math.round(asset.heading || 0) + '°');
  set('r-east', (asset.offset?.east ?? 0).toFixed(0) + ' m');
  set('r-south', (asset.offset?.south ?? 0).toFixed(0) + ' m');
  set('r-up', (asset.offset?.up ?? 0).toFixed(1) + ' m');
  set('r-pin', location.lat.toFixed(6) + ', ' + location.lng.toFixed(6));
}

async function savePlacement() {
  const msg = $('#place-msg');
  msg.textContent = 'Saving...';
  try {
    await api('PATCH', '/api/projects/' + place.project.id, {
      location: place.location,
      plan: { asset: place.asset },
    });
    place.dirty = false;
    $('#place-save').disabled = true;
    msg.textContent = 'Saved. The map will use this straight away.';
    await refresh();
    paintList();
  } catch (err) {
    msg.textContent = err.message;
  }
}

/* ------------------------------------------------------------------- photos */

function paintPhotos(p) {
  const images = p.images || [];
  const byCategory = state.meta.imageCategories
    .map((c) => [c, images.filter((im) => im.category === c)])
    .filter(([, list]) => list.length);

  $('#editor-body').innerHTML = `
    <div class="pane">
      <h3>Add photos</h3>
      <p class="hint">Renders, site shots, amenity photos, interiors, floor plates. They
        are resized to a display copy and a thumbnail on upload, so a 12 MB camera JPEG
        does not land in the detail panel at full size.</p>
      <label class="field" style="max-width:240px;margin-bottom:12px">
        <span>File these under</span>
        <select id="photo-category">
          ${state.meta.imageCategories.map((c) => `<option value="${c}">${title(c)}</option>`).join('')}
        </select>
      </label>
      <div class="drop" id="photo-drop">
        <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-5 4 4 3-2 4 4"/></svg>
        <b>Drop images</b>
        <span>jpg, png or webp &mdash; several at once is fine</span>
      </div>
      <div id="photo-progress"></div>
    </div>

    ${images.length ? `<div class="pane">
      <h3>${images.length} photo${images.length === 1 ? '' : 's'}</h3>
      <p class="hint">The first one, in this order, becomes the panel's cover image.</p>
      ${byCategory.map(([category, list]) => `
        <div class="photo-group">
          <h4>${title(category)} <span>${list.length}</span></h4>
          <div class="photo-grid">${list.map((im) => photoCard(im)).join('')}</div>
        </div>`).join('')}
      </div>`
      : `<div class="pane"><p class="hint" style="margin:0">No photos yet. The detail panel falls
         back to the generated skyline until there is at least one.</p></div>`}`;

  wirePhotoDrop(p);
  for (const el of $$('[data-image]')) {
    const id = el.dataset.image;
    if (el.matches('.remove')) el.onclick = () => removeImage(p, id);
    else el.onchange = () => updateImage(p, id, el.name, el.value);
  }
}

const photoCard = (im) => `
  <div class="photo">
    <div class="shot" style="background-image:url('${im.thumb}')">
      <button class="remove" data-image="${im.id}" aria-label="Delete this photo">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
    <div class="meta">
      <input data-image="${im.id}" name="caption" value="${esc(im.caption || '')}" placeholder="Caption" />
      <select data-image="${im.id}" name="category">
        ${state.meta.imageCategories
          .map((c) => `<option value="${c}" ${c === im.category ? 'selected' : ''}>${title(c)}</option>`)
          .join('')}
      </select>
      <span class="bytes">${kb(im.bytes)}${im.width ? ` &middot; ${im.width}&times;${im.height}` : ''}</span>
    </div>
  </div>`;

function wirePhotoDrop(p) {
  const drop = $('#photo-drop');
  const send = (files) => sendPhotos(p, [...files]);
  drop.onclick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = () => send(input.files);
    input.click();
  };
  drop.ondragover = (e) => {
    e.preventDefault();
    drop.classList.add('over');
  };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    send(e.dataTransfer.files);
  };
}

async function sendPhotos(p, files) {
  const host = $('#photo-progress');
  const category = $('#photo-category').value;
  host.innerHTML = `<div class="joblog" id="photo-log">uploading ${files.length} file${files.length === 1 ? '' : 's'}...</div>`;
  const log = $('#photo-log');
  const append = (line, cls = '') => {
    log.insertAdjacentHTML('beforeend', `\n<span class="${cls}">${esc(line)}</span>`);
    log.scrollTop = log.scrollHeight;
  };

  for (const file of files) {
    try {
      const record = await upload(
        `/api/projects/${p.id}/images?filename=${encodeURIComponent(file.name)}&category=${category}`,
        file
      );
      append(`${file.name}: ${mb(file.size)} -> ${kb(record.bytes)}`, 'good');
    } catch (err) {
      append(`${file.name}: ${err.message}`, 'bad');
    }
  }
  await refresh();
  render();
}

async function removeImage(p, imageId) {
  await api('DELETE', `/api/projects/${p.id}/images/${imageId}`);
  await refresh();
  render();
}

async function updateImage(p, imageId, key, value) {
  const project = state.projects.find((x) => x.id === p.id);
  const images = project.images.map((im) => (im.id === imageId ? { ...im, [key]: value } : im));
  await api('PATCH', '/api/projects/' + p.id, { images });
  await refresh();
  toast('Photo updated');
}

/* ------------------------------------------------------------------ create */

async function newProject() {
  const name = prompt('Project name');
  if (!name) return;
  try {
    const created = await api('POST', '/api/projects', {
      name,
      developer: 'New developer',
      city: 'Bengaluru',
      locality: 'Locality',
      // the country view centre, so a brand-new project is somewhere findable
      lng: 77.5946,
      lat: 12.9716,
      acres: 12,
      towers: 4,
      units: 300,
      priceFrom: 9000000,
      unitTypes: ['2 BHK', '3 BHK'],
      sizeRange: '900 - 1,800 sq.ft.',
      status: 'New Launch',
      possession: 'Dec 2028',
      tagline: '',
    });
    await refresh();
    state.selectedId = created.id;
    state.tab = 'details';
    render();
    toast('Created - fill in the details, then add a model');
  } catch (err) {
    toast(err.message);
  }
}

async function deleteProject(p) {
  if (!confirm(`Delete ${p.name}? Its model and photos go with it.`)) return;
  await api('DELETE', '/api/projects/' + p.id);
  state.selectedId = null;
  await refresh();
  render();
  toast('Deleted');
}

/* -------------------------------------------------------------------- misc */

let toastTimer = null;
function toast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

const title = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const kb = (n) => (n < 1024 * 1024 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
const mb = (n) => (n / 1048576).toFixed(1) + ' MB';

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function shade(hex, pct) {
  const n = parseInt(hex.slice(1), 16);
  const amt = Math.round(2.55 * pct);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  return '#' + ((1 << 24) + (clamp((n >> 16) + amt) << 16) + (clamp(((n >> 8) & 0xff) + amt) << 8) + clamp((n & 0xff) + amt)).toString(16).slice(1);
}
