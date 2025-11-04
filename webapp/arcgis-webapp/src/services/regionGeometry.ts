import type { QueryGeometry, RegionCircle, RegionPolygon, RegionShape } from '@/types';

const METERS_PER_DEGREE_LAT = 111_320;
const DEFAULT_SEGMENTS = 64;

function createRingFromCircle(circle: RegionCircle, segments: number): [number, number][] | undefined {
  const { lat, lng, radius } = circle;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radius) || radius <= 0) {
    return undefined;
  }

  const metersPerDegreeLng = METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
  if (!Number.isFinite(metersPerDegreeLng) || metersPerDegreeLng === 0) {
    return undefined;
  }

  const ring: [number, number][] = [];
  for (let step = 0; step < segments; step += 1) {
    const theta = (2 * Math.PI * step) / segments;
    const pointLat = lat + (Math.cos(theta) * radius) / METERS_PER_DEGREE_LAT;
    const pointLng = lng + (Math.sin(theta) * radius) / metersPerDegreeLng;
    ring.push([pointLng, pointLat]);
  }

  if (ring.length === 0) {
    return undefined;
  }

  ring.push([...ring[0]]);
  return ring;
}

function createRingFromPolygon(polygon: RegionPolygon): [number, number][] | undefined {
  const { points } = polygon;
  if (!Array.isArray(points) || points.length < 3) {
    return undefined;
  }

  const ring: [number, number][] = points
    .map((point) => [point.lng, point.lat] as [number, number])
    .filter((entry) => Number.isFinite(entry[0]) && Number.isFinite(entry[1]));

  if (ring.length < 3) {
    return undefined;
  }

  const [firstLng, firstLat] = ring[0];
  const [lastLng, lastLat] = ring[ring.length - 1];
  if (firstLng !== lastLng || firstLat !== lastLat) {
    ring.push([firstLng, firstLat]);
  }

  return ring;
}

export function regionsToPolygonGeometry(
  regions: readonly RegionShape[],
  segments = DEFAULT_SEGMENTS,
): QueryGeometry | undefined {
  if (!Array.isArray(regions) || regions.length === 0) {
    return undefined;
  }

  const rings = regions
    .map((region) => {
      if (region.type === 'circle') {
        return createRingFromCircle(region, segments);
      }
      return createRingFromPolygon(region);
    })
    .filter((ring): ring is [number, number][] => Array.isArray(ring) && ring.length > 3);

  if (!rings.length) {
    return undefined;
  }

  return {
    rings,
    spatialReference: { wkid: 4326 },
    geometryType: 'esriGeometryPolygon',
  } as QueryGeometry;
}

export function circlesToPolygonGeometry(
  circles: readonly RegionCircle[],
  segments = DEFAULT_SEGMENTS,
): QueryGeometry | undefined {
  return regionsToPolygonGeometry(circles, segments);
}
