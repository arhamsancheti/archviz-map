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

/** Do segments p1-p2 and p3-p4 cross? Orientation test, collinear cases included. */
const segmentsCross = (p1, p2, p3, p4) => {
  const dir = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  const on = (a, b, c) =>
    Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1]);
  const d1 = dir(p3, p4, p1);
  const d2 = dir(p3, p4, p2);
  const d3 = dir(p1, p2, p3);
  const d4 = dir(p1, p2, p4);
  if (d1 !== d2 && d3 !== d4) return true;
  return (
    (d1 === 0 && on(p3, p4, p1)) || (d2 === 0 && on(p3, p4, p2)) ||
    (d3 === 0 && on(p1, p2, p3)) || (d4 === 0 && on(p1, p2, p4))
  );
};

/** Any edge of `a` crossing any edge of `b`. Both rings are small, so this is cheap. */
const ringsCross = (a, b) => {
  for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
    for (let k = 0, l = b.length - 1; k < b.length; l = k++) {
      if (segmentsCross(a[j], a[i], b[l], b[k])) return true;
    }
  }
  return false;
};

/**
 * Whether a tile feature's geometry touches any site. A cheap bbox reject first,
 * then containment both ways (a building vertex inside the site, or a site vertex
 * inside the building), and finally an edge-crossing test.
 *
 * The edge test is not redundant: two rectangles can overlap in a cross shape with
 * no vertex of either inside the other, and a long building clipping a site corner
 * hits exactly that case. Containment alone would miss it.
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
      if (ringsCross(ring, box.ring)) return true;
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
