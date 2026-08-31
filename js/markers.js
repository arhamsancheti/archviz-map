/**
 * Screen-space clustering for the project pins.
 *
 * Done by hand rather than with MapLibre's GeoJSON clustering so the labels can be
 * real DOM (crisp text, hover states, no dependency on the basemap's glyph fonts),
 * and so one marker pool serves both the cluster and the single-project case.
 */
import { LOD } from './config.js';
import { amenityIcon } from './ui.js';
import { offsetLngLat } from './geo.js';

export class MarkerLayer {
  constructor(map, { onSelect, onCluster }) {
    this.map = map;
    this.onSelect = onSelect;
    this.onCluster = onCluster;
    this.pool = new Map(); // key -> maplibregl.Marker
    this.amenityPool = new Map();
    this.amenityProjectId = null;
  }

  update(projects, selectedId) {
    const zoom = this.map.getZoom();
    const canvas = this.map.getCanvas();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const cell = zoom < LOD.massingMinZoom ? 118 : 0;

    const tr = this.map.transform;
    const occluded = (lngLat) => {
      // on a globe, the far side of the planet still projects to a screen point
      if (!tr || typeof tr.isLocationOccluded !== 'function') return false;
      try {
        return tr.isLocationOccluded(lngLat);
      } catch {
        return false;
      }
    };

    const onScreen = [];
    for (const p of projects) {
      if (occluded(p.location)) continue;
      const pt = this.map.project([p.location.lng, p.location.lat]);
      if (pt.x < -160 || pt.x > w + 160 || pt.y < -120 || pt.y > h + 120) continue;
      onScreen.push({ p, pt });
    }

    const groups = new Map();
    for (const item of onScreen) {
      const key = cell
        ? 'c' + Math.floor(item.pt.x / cell) + ':' + Math.floor(item.pt.y / cell)
        : 'p' + item.p.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item.p);
    }

    const seen = new Set();
    for (const [key, members] of groups) {
      seen.add(key);
      const lng = members.reduce((n, p) => n + p.location.lng, 0) / members.length;
      const lat = members.reduce((n, p) => n + p.location.lat, 0) / members.length;

      let marker = this.pool.get(key);
      if (!marker) {
        const el = document.createElement('div');
        el.className = 'pin-label';
        marker = new maplibregl.Marker({ element: el, anchor: 'bottom' });
        marker.setLngLat([lng, lat]).addTo(this.map);
        marker._sig = null;
        this.pool.set(key, marker);
      } else {
        marker.setLngLat([lng, lat]);
      }

      // Position updates every frame; the DOM content may not. innerHTML on ten
      // markers at 60fps parses and allocates for nothing, which phones notice -
      // rewrite only when the label's meaning actually changed.
      const sig =
        members.length > 1
          ? 'c' + members.map((p) => p.id).join()
          : 'p' + members[0].id + (members[0].id === selectedId ? '*' : '');
      if (marker._sig !== sig) {
        marker._sig = sig;
        const el = marker.getElement();
        if (members.length > 1) {
          el.innerHTML =
            `<i style="background:${members[0].accent}"></i><span class="count">${members.length}</span>projects`;
          el.classList.remove('selected');
          el.onclick = () => this.onCluster([lng, lat], members);
        } else {
          const p = members[0];
          el.innerHTML = `<i style="background:${p.accent}"></i>${p.name}`;
          el.classList.toggle('selected', p.id === selectedId);
          el.onclick = () => this.onSelect(p.id);
        }
      }
    }

    for (const [key, marker] of this.pool) {
      if (!seen.has(key)) {
        marker.remove();
        this.pool.delete(key);
      }
    }
  }

  /**
   * Amenity hotspots for one project, shown only at close range.
   * Idempotent: the camera settling (including flying to an amenity you just
   * clicked) must not tear these down and replay their entry animation.
   */
  showAmenities(project, onPick) {
    if (!project) {
      this.clearAmenities();
      return;
    }
    if (this.amenityProjectId === project.id && this.amenityPool.size) return;
    this.clearAmenities();
    this.amenityProjectId = project.id;
    const rot = project.plan.site.rot;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    project.plan.amenities.forEach((a, i) => {
      const x = a.x * cos - a.z * sin;
      const z = a.x * sin + a.z * cos;
      const el = document.createElement('div');
      el.className = 'amenity-marker';
      el.style.animationDelay = i * 45 + 'ms';
      el.innerHTML = `<em>${amenityIcon(a.kind)}</em><span class="lbl">${a.name}</span>`;
      el.onclick = () => onPick(project, a);
      const m = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat(offsetLngLat(project.location, x, z))
        .addTo(this.map);
      this.amenityPool.set(project.id + ':' + i, m);
    });
  }

  clearAmenities() {
    for (const m of this.amenityPool.values()) m.remove();
    this.amenityPool.clear();
    this.amenityProjectId = null;
  }

  clearAll() {
    for (const m of this.pool.values()) m.remove();
    this.pool.clear();
    this.clearAmenities();
  }
}
