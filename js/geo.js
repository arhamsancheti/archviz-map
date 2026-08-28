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
 * Every site as one MultiPolygon, for cutting the basemap's OSM buildings out from
 * under our own geometry. Without this, the generic OSM blocks for a plot sit inside
 * the client's actual towers.
 *
 * Padded outwards a little so a building sitting right on the boundary goes too.
 */
export function siteCutout(projects, padM = 12) {
  return {
    type: 'MultiPolygon',
    coordinates: projects.map((p) => siteFeature(p, padM).geometry.coordinates),
  };
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
