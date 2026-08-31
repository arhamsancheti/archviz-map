# VU - a 3D project map for the web

A lightweight web counterpart to our Unreal archviz product. One map carries every
client's project: you see them as pins across the country, fly in, and the project's
3D model streams in at the right moment. Click it for pricing, amenities, unit mix,
and a hand-off into the full immersive build.

Runs in a browser, on a phone, with no plugin and no API keys.

## Run it

```bash
cd archviz-map
node serve.mjs          # the map     http://localhost:5173
                        # the admin   http://localhost:5173/admin
```

The map itself needs nothing installed - MapLibre and three.js come from a CDN and
`serve.mjs` serves the files. Run `npm install` once if you want to upload models and
photos through the admin, which is where the heavy lifting lives.

Deep links work: `http://localhost:5173/?p=lakeside-habitat`.

## What you can do in it

- The map opens as a **globe**. Pan and spin it; MapLibre eases into the flat map by
  itself as you zoom in, so close-up work is unaffected. The globe/flat button is in
  the bottom-right tools.
- Projects cluster when you are far out and label themselves as you get closer.
- Click a project card or its pin. The camera flies in, the 3D master plan streams in,
  and the detail panel opens.
- Amenity hotspots appear on the model past zoom 16. Hover one to read its name;
  clicking one, in the panel or on the map, flies the camera to it.
- **Overview / Units / Amenities / Location** tabs in the detail panel: unit mix with
  price and availability per configuration, construction progress, what is nearby with
  distances, and the specification.
- **Ask for what you want.** The search box parses a sentence into filters:
  `3 BHK under 1.5 Cr in Pune with a pool` becomes four chips you can remove one at a
  time. It understands configurations, budgets (`under 1.5 cr`, `₹1 Cr to ₹2 Cr`,
  `above 90 lakh`), cities and their nicknames, builders, status, possession year,
  minimum size, amenities, and ranking words (`cheapest`, `luxury`, `largest`).
- **Filters** panel for the same facets as switches, plus a budget slider, with a live
  result count. Touching a control the sentence is currently driving hands that facet
  back to the panel - the phrase is spliced out of the search box, so nothing is ever
  set and silently ignored.
- **Sort** by price, possession, home size, site size or name.
- One tap on the map controls bottom-right: zoom, face north, terrain and city
  buildings, globe / flat, orbit the selected project, back to the country view.
- `/` focuses the search box, `Esc` closes whatever is open.

## How the loading works

The whole point of this build is that a hundred clients cannot all be in memory at once.

| Tier | When | What renders | Cost |
|---|---|---|---|
| Pin | zoom < 12.5 | clustered dots from the registry | a few KB, once |
| Massing | 12.5 - 14.6 | tower footprints extruded by the GPU straight from the registry numbers | no asset fetch at all |
| Model | zoom > 14.6, in viewport | the real geometry, nearest 4 projects only | only what is on screen |
| Detail | zoom > 16, selected | amenity hotspots, shadows | one project |

`js/streaming.js` re-evaluates this on every camera move: projects outside the padded
viewport are dropped, the nearest few get geometry, the selected one is pinned, and
anything over the LRU or memory budget is disposed (geometry freed, not just hidden).
Textures and materials are shared across every project, so the ninth tower costs
geometry only.

`SIMULATE_NETWORK` at the top of `js/streaming.js` adds a delay standing in for the
real CDN fetch of a client's `.glb`, sized from the asset bytes in the registry.
Procedural builds finish in milliseconds, so without it you cannot see the streaming
happen. Set `enabled: false` for raw speed.

## Adding a client project

Open **http://localhost:5173/admin**. Three tabs per project:

**Details.** Name, developer, locality, price, configurations, land area, towers,
possession, RERA, accent colour. Saving rebuilds the generated parts - unit mix,
nearby places, the specification, the master plan - from those numbers. The plan is
seeded on the project id, so re-saving never reshuffles a site you have already
placed a model on.

**Model & placement.** Drop the export in. It is optimised into the three builds the
map streams (below), and the report tells you what came off. Then drag the handle to
move it, and set which way it faces and how big it is. That panel is the map's own
renderer, on the real terrain, inside the real site outline - what you align is what
the product draws. The live readout says how big the model actually is at the current
scale, which is how you catch a centimetres export before it lands as a district.

**Photos.** Renders, site shots, amenities, interiors, floor plates. They are resized
to a display copy and a thumbnail on upload. The first one becomes the panel's cover
image; the rest become the strip under the tagline and open full-size on click.

Everything is written straight into `data/projects.json`, which is the only thing the
map reads. Editing that file by hand still works, and so does the seeded generator:

```bash
node tools/gen-projects.mjs      # rewrites the demo ten
```

Both routes go through the same `makeProject` in `tools/registry-lib.mjs`, so a
project created either way is the same shape.

The admin binds to localhost and has no login, because it is a local authoring tool.
Putting it on a network means putting a real login in front of it first.

## Placing a real model (lat/lng + .glb)

Short answer: yes. Give me a location and a model and it lands on the map. The loader
already branches to glTF, and placement is driven by data, not code.

**What the file needs to be**

| Thing | What works | If it is not |
|---|---|---|
| Format | `.glb` (or `.gltf` + `.bin`), Draco or Meshopt compressed | anything else - convert first |
| Units | metres | set `scale` (Unreal centimetres -> `0.01`) |
| Up axis | Y-up (what the glTF spec and Unreal's exporter produce) | a Z-up export lands on its side |
| Origin | model pivot at the point the lat/lng refers to, ideally the site centre | nudge with `offset` in metres |
| Heading | site aligned to true north | set `heading`, degrees clockwise from north |

Vertical is handled for you: `autoGround` drops the model so its lowest point rests on
the ground. There is no terrain yet, so ground is a flat plane at altitude 0.

**What I need from you per project:** the lat/lng of the model's origin, which way it
faces, and what units it was exported in. Everything else is derivable.

**The registry entry**

```json
"asset": {
  "format": "glb",
  "lods": {
    "high": { "url": "models/lakeside/high.glb", "bytes": 7400000 },
    "mid":  { "url": "models/lakeside/mid.glb",  "bytes": 1800000 },
    "low":  { "url": "models/lakeside/low.glb",  "bytes":  420000 }
  },
  "scale": 1,
  "heading": 0,
  "offset": { "east": 0, "up": 0, "south": 0 },
  "autoGround": true
}
```

A single `"url"` instead of `lods` works too - every level then uses that one file.

If the size looks wrong, the console says so: the loader measures the model footprint
on load and warns with the exact `scale` to set if it looks like a unit mismatch.

## Making the LODs, and optimising the high-poly mesh

The admin upload does this for you. The same pipeline is on the command line:

```bash
npm install                                   # once
node tools/prepare-model.mjs export.glb --id lakeside-habitat
```

That emits `models/<id>/{high,mid,low}.glb` and prints the `asset` block above, filled
in, ready to paste. Both routes call `buildLods` in `tools/optimize.mjs`, so they
cannot drift.

Every level gets the same cleanup first, and the order matters:

| Step | Why |
|---|---|
| `dedup` | byte-identical meshes, materials and textures collapse to one |
| `instance` | repeated parts - windows, balconies, railings - become GPU instances. An archviz export is mostly repeats, so this is the cheapest big win there is |
| `flatten` | drops the deep empty-node hierarchies exporters leave behind |
| `join` | merges what shares a material. Draw calls, not triangles, are usually what actually costs you |
| `weld` | merges coincident vertices, and is required before simplification |
| `resample` | thins animation keyframes |

Then per level: `mid` keeps ~35% of the triangles and `low` ~8% using meshoptimizer's
simplifier, textures are resized (2048 / 1024 / 256) and converted to WebP if `sharp`
is installed, and the geometry is Draco-compressed. Nothing above changes what the
model looks like except the simplifier, which is off for `high`.

Measured on the sample export (`node tools/make-sample-glb.mjs sample.glb`):

| Level | Size | Triangles | Draw calls |
|---|---|---|---|
| source | 442 KB | 18,480 | 5 |
| high | 27 KB | 18,480 | 1 |
| mid | 16 KB | 6,468 | 1 |
| low | 5 KB | 1,477 | 1 |

The high build keeps every triangle and is still 94% smaller, because most of the win
is compression and joining, not decimation. Real exports with textures compress less
dramatically but gain more from the texture resizing.

**Which level loads when** is in `LOD.assetLevels` (`js/config.js`): low from zoom 14.6,
mid from 15.6, high from 16.4. The streaming manager swaps builds as you move, and only
frees the old one once the new one has finished loading, so there is no empty frame.
The HUD shows the current level next to the tier.

## The 3D world around a project

A project should look like it is *in* a city, not floating on a diagram. Three things
give that, and all three are on by default (the button bottom-right toggles them):

- **Terrain.** Real elevation from the Mapzen / AWS open elevation tiles - free, no
  key. Verified decoding correctly: 222 m at Gurugram, 817 m at Bengaluru.
- **City buildings.** The basemap's vector tiles already carry OSM building
  footprints, so we extrude those by their height tags. This costs **no extra
  download** - the tiles are being fetched for the basemap anyway.
- **Sky and atmosphere.** MapLibre's sky layer, tinted per basemap, so the horizon
  reads as air rather than a cut-off edge.

Our models sit *on* the terrain: elevation is sampled at each project's pin and passed
as the model altitude, refreshed when the map goes idle because elevation tiles arrive
asynchronously.

### Why not Google or Cesium

| Option | Look | Cost | Verdict |
|---|---|---|---|
| **This build** - OSM extrusions + DEM terrain | clean, Apple-Maps-ish; buildings are boxes | free, no key | right for now |
| **Google Photorealistic 3D Tiles** | the best; real textured mesh of whole cities | API key + per-request billing | worth it if the client demo justifies the bill |
| **Cesium Ion / Cesium OSM Buildings** | good terrain, worldwide building set | free tier with a token, paid above it | the upgrade if we want terrain quality without Google pricing |
| **Bing/Esri 3D** | patchy coverage in India | key | no |

Switching later is contained: it changes the basemap and how the ground renders, not
the registry, the streaming ladder, or how our own models are placed. The one thing to
know is that Google's tiles arrive as their own 3D Tiles renderer, so our three.js
layer would need to share depth with that instead of MapLibre.

### Known rough edges

- A flat site plate on sloping ground will clip. Fine for the flat city sites we have;
  a hill project needs the plate draped on the terrain.
- If the basemap's building tiles carry no height tag, the fallback is 3 storeys, so
  those blocks look uniform.
- Terrain exaggeration is 1.0 (real). Raise `WORLD.exaggeration` for drama on hill sites.

## Files

```
index.html            shell
css/app.css           all styling, light + dark
js/config.js          basemap, LOD thresholds, camera presets, formatters
js/geo.js             metres <-> lng/lat, footprint polygons
js/buildings.js       procedural master plan, shared texture/material cache, dispose
js/scene.js           three.js layer sharing MapLibre's WebGL context, lights, shadows
js/streaming.js       viewport culling, load queue, LRU eviction, memory accounting
js/markers.js         screen-space pin clustering, amenity hotspots
js/filters.js         facets, matching, sorting, and the search-sentence parser
js/ui.js              list, filter panel, detail panel, HUD, toasts
js/app.js             wiring
data/projects.json    the client registry (generated)
tools/gen-projects.mjs  generator for the above
tools/prepare-model.mjs CLI over tools/optimize.mjs
tools/make-sample-glb.mjs  throwaway export for trying the pipeline
js/admin.js           the authoring UI: form, model upload, placement, photos
css/admin.css         admin layout, on top of the app's tokens
admin.html            admin shell
serve.mjs             static serving + the admin API
tools/optimize.mjs      the model pipeline as a library
tools/registry-lib.mjs  plan and facts generation, shared by the CLI and the API
media/<id>/           uploaded photos (display copy + thumbnail)
models/<id>/          the three streamed builds of a client's model
PROGRESS.md           build log, decisions, what is left
```

`window.__app` exposes `{ map, scene, streaming, markers, state }` in the console for
poking at it live. `__app.streaming.stats()` reports the current tier, asset level,
how many models are resident and how much geometry is on the GPU - the numbers the
old on-screen streaming panel used to show.

## Choices worth knowing

- **MapLibre GL JS v5, not Cesium or Google's photorealistic tiles.** No API key, no
  per-load billing, and the vector basemap reads closer to Apple Maps. v5 is what
  gives us globe projection. Cesium plus 3D Tiles is the upgrade path if we need
  terrain and real city meshes.
- **Each project renders in its own local frame**, from
  `map.transform.getMatrixForModel(lngLat, 0)`, one render pass per resident model.
  That is what puts geometry in the right place on a curved globe, and it avoids
  placing objects directly in mercator units (float32 precision falls apart there).
- **three.js shares MapLibre's WebGL context** rather than sitting on a second canvas,
  so buildings share the map's depth buffer and camera. One context, correct occlusion.
- **One basemap: Carto Voyager**, usable without a key. Its vector tiles carry the OSM
  building footprints we extrude for city context, which a raster imagery layer does
  not - that, plus a single lighting rig to tune, is why the night and satellite
  options went. Attribution is on the map; for production, check Carto's terms or move
  to a self-hosted tile server.

## What production needs next

1. **Real geometry pipeline at scale.** The upload path works; a large township wants
   3D Tiles rather than one .glb, so it streams progressively. Host on a CDN.
2. **Interiors.** Keep them in the Unreal build and deep-link, or pixel-stream a
   session on demand from the button that is already wired.
3. **Auth and multi-tenancy on the admin.** It writes a JSON file and trusts whoever
   can reach it, which is right for a local tool and wrong for anything shared.
   A login, per-client scoping, and a database instead of a file.
4. **Analytics** - which projects get opened, how long people stay, where from. This is
   the thing builders will pay for on top of the model.
5. **Real placement.** Right now a project sits at its pin with a generated footprint.
   Real projects need a surveyed origin, rotation and site polygon.
6. **Mobile pass.** The layout adapts, but test GPU memory budgets on mid-range
   Android; `LOD.maxResidentModels` and `memoryBudgetMB` are the dials.
