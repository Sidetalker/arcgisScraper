import type { QueryGeometry, RegionCircle } from '@/types';

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

export function circlesToPolygonGeometry(
  circles: readonly RegionCircle[],
  segments = DEFAULT_SEGMENTS,
): QueryGeometry | undefined {
  if (!Array.isArray(circles) || circles.length === 0) {
    return undefined;
  }

  const rings = circles
    .map((circle) => createRingFromCircle(circle, segments))
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
