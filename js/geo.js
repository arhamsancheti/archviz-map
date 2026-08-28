/** Small geo helpers. Everything in the registry is metres relative to a project pin. */

const M_PER_DEG_LAT = 111320;

export const mPerDegLng = (lat) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

/** Offset a lng/lat by metres east (x) and south (z) - matching the scene's axes. */
export function offsetLngLat(origin, x, z) {
  return [
    origin.lng + x / mPerDegLng(origin.lat),
    origin.lat - z / M_PER_DEG_LAT,
  ];
}

/** Great-circle-ish distance in km. Good enough for viewport culling. */
export function distanceKm(a, b) {
  const dx = (a.lng - b.lng) * mPerDegLng((a.lat + b.lat) / 2);
  const dy = (a.lat - b.lat) * M_PER_DEG_LAT;
  return Math.sqrt(dx * dx + dy * dy) / 1000;
}

/** Rectangle footprint -> GeoJSON ring, rotated about the project pin. */
export function footprintRing(origin, cx, cz, w, d, rot) {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const hw = w / 2;
  const hd = d / 2;
  const corners = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([px, pz]) => {
    const rx = px * cos - pz * sin;
    const rz = px * sin + pz * cos;
    return offsetLngLat(origin, cx + rx, cz + rz);
  });
  corners.push(corners[0]);
  return corners;
}

/** Everything a project contributes to the cheap GPU-only massing tier. */
export function massingFeatures(project) {
  const o = project.location;
  const rot = project.plan.site.rot;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const spin = (x, z) => [x * cos - z * sin, x * sin + z * cos];

  const features = project.plan.towers.map((t) => {
    const [x, z] = spin(t.x, t.z);
    return {
      type: 'Feature',
      properties: {
        projectId: project.id,
        height: t.height,
        accent: project.accent,
      },
      geometry: { type: 'Polygon', coordinates: [footprintRing(o, x, z, t.w, t.d, rot + t.rot)] },
    };
  });

  const p = project.plan.podium;
  features.push({
    type: 'Feature',
    properties: { projectId: project.id, height: p.height, accent: project.accent },
    geometry: { type: 'Polygon', coordinates: [footprintRing(o, 0, 0, p.w, p.d, rot)] },
  });

  return features;
}

/** The site boundary, used as a soft ground tint under a project. */
export function siteFeature(project, padM = 0) {
  const s = project.plan.site;
  return {
    type: 'Feature',
    properties: { projectId: project.id, accent: project.accent },
    geometry: {
      type: 'Polygon',
      coordinates: [footprintRing(project.location, 0, 0, s.w + padM * 2, s.d + padM * 2, s.rot)],
    },
  };
}

/**
 * Padded site outlines with bounding boxes, for testing tile features against.
 * Used by the city-building cutout: MapLibre's `within` operator silently returns
 * false for Polygon inputs (it only supports Point and LineString), so a style
 * filter can never ask "is this building polygon inside a site" - instead we find
 * the overlapping buildings ourselves and exclude them by feature id.
 */
export function siteBoxes(projects, padM = 12) {
  return projects.map((p) => {
    const ring = siteFeature(p, padM).geometry.coordinates[0];
    const lngs = ring.map((c) => c[0]);
    const lats = ring.map((c) => c[1]);
    return {
      projectId: p.id,
      ring,
      bbox: [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)],
    };
  });
}

const pointInRing = (x, y, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/**
 * Whether a tile feature's geometry touches any site. A cheap bbox reject first,
 * then two containment tests so a building straddling the boundary is caught too
 * (either of its vertices inside the site, or a site vertex inside the building).
 */
export function hitsAnySite(geometry, boxes) {
  const polys =
    geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates
    : [];
  for (const box of boxes) {
    for (const poly of polys) {
      const ring = poly[0];
      let lx = Infinity, ly = Infinity, hx = -Infinity, hy = -Infinity;
      for (const [x, y] of ring) {
        if (x < lx) lx = x;
        if (x > hx) hx = x;
        if (y < ly) ly = y;
        if (y > hy) hy = y;
      }
      if (hx < box.bbox[0] || hy < box.bbox[1] || lx > box.bbox[2] || ly > box.bbox[3]) continue;
      if (ring.some(([x, y]) => pointInRing(x, y, box.ring))) return true;
      if (box.ring.some(([x, y]) => pointInRing(x, y, ring))) return true;
    }
  }
  return false;
}

/**
 * Lowest and highest ground under a site.
 *
 * A project pad is flat, so seating it on the elevation at its pin makes it cut into
 * the hill on the uphill side. Sampling the whole footprint lets us sit the pad on
 * the high point instead, and tells us how far the ground falls away from it.
 *
 * Returns null when terrain is off or not loaded yet.
 */
export function sampleGround(map, origin, radiusM) {
  if (!map || typeof map.queryTerrainElevation !== 'function') return null;
  const offsets = [[0, 0]];
  for (const r of [radiusM * 0.55, radiusM]) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      offsets.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
  }

  let min = Infinity;
  let max = -Infinity;
  for (const [dx, dz] of offsets) {
    const [lng, lat] = offsetLngLat(origin, dx, dz);
    let v = null;
    try {
      v = map.queryTerrainElevation({ lng, lat });
    } catch {
      return null;
    }
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { min, max, relief: max - min };
}
