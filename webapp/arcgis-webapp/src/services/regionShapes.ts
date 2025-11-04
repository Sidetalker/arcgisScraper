import type { RegionCircle, RegionPoint, RegionPolygon, RegionShape } from '@/types';

const EARTH_RADIUS_METERS = 6_371_000;
const COORDINATE_EPSILON = 1e-6;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalisePoint(point: unknown): RegionPoint | null {
  if (!point || typeof point !== 'object') {
    return null;
  }

  const lat = (point as { lat?: unknown; latitude?: unknown }).lat ?? (point as { lat?: unknown; latitude?: unknown }).latitude;
  const lng = (point as { lng?: unknown; longitude?: unknown }).lng ?? (point as { lng?: unknown; longitude?: unknown }).longitude;

  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) {
    return null;
  }

  return { lat, lng };
}

function dedupeSequentialPoints(points: RegionPoint[]): RegionPoint[] {
  if (points.length === 0) {
    return points;
  }

  const result: RegionPoint[] = [];
  let previous: RegionPoint | null = null;
  for (const point of points) {
    if (
      previous &&
      Math.abs(previous.lat - point.lat) < COORDINATE_EPSILON &&
      Math.abs(previous.lng - point.lng) < COORDINATE_EPSILON
    ) {
      continue;
    }
    result.push(point);
    previous = point;
  }

  if (result.length > 1) {
    const first = result[0];
    const last = result[result.length - 1];
    if (
      Math.abs(first.lat - last.lat) < COORDINATE_EPSILON &&
      Math.abs(first.lng - last.lng) < COORDINATE_EPSILON
    ) {
      result.pop();
    }
  }

  return result;
}

function normaliseCircle(candidate: unknown): RegionCircle | null {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const circle = candidate as Partial<RegionCircle> & {
    lat?: unknown;
    lng?: unknown;
    radius?: unknown;
  };

  const lat = isFiniteNumber(circle.lat) ? circle.lat : isFiniteNumber((circle as { center?: { lat?: number } }).center?.lat) ? (circle as { center: RegionPoint }).center.lat : null;
  const lng = isFiniteNumber(circle.lng) ? circle.lng : isFiniteNumber((circle as { center?: { lng?: number } }).center?.lng) ? (circle as { center: RegionPoint }).center.lng : null;
  const radius = isFiniteNumber(circle.radius) ? circle.radius : null;

  if (lat === null || lng === null || radius === null || radius <= 0) {
    return null;
  }

  return { type: 'circle', lat, lng, radius };
}

function normalisePolygon(candidate: unknown): RegionPolygon | null {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const polygon = candidate as Partial<RegionPolygon> & { points?: unknown; rings?: unknown };

  const rawPoints: RegionPoint[] = [];

  if (Array.isArray(polygon.points)) {
    for (const point of polygon.points) {
      const normalised = normalisePoint(point);
      if (normalised) {
        rawPoints.push(normalised);
      }
    }
  } else if (Array.isArray(polygon.rings) && polygon.rings.length > 0) {
    const firstRing = polygon.rings[0];
    if (Array.isArray(firstRing)) {
      for (const entry of firstRing) {
        if (Array.isArray(entry) && entry.length >= 2) {
          const [lng, lat] = entry;
          if (isFiniteNumber(lat) && isFiniteNumber(lng)) {
            rawPoints.push({ lat, lng });
          }
        } else {
          const normalised = normalisePoint(entry);
          if (normalised) {
            rawPoints.push(normalised);
          }
        }
      }
    }
  }

  const points = dedupeSequentialPoints(rawPoints);

  if (points.length < 3) {
    return null;
  }

  return { type: 'polygon', points };
}

export function normaliseRegionShape(candidate: unknown): RegionShape | null {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  if ((candidate as { type?: unknown }).type === 'polygon') {
    return normalisePolygon(candidate);
  }

  if ((candidate as { type?: unknown }).type === 'circle') {
    return normaliseCircle(candidate);
  }

  return normaliseCircle(candidate) ?? normalisePolygon(candidate);
}

export function normaliseRegionList(value: unknown): RegionShape[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const regions: RegionShape[] = [];
  value.forEach((candidate) => {
    const normalised = normaliseRegionShape(candidate);
    if (normalised) {
      regions.push(normalised);
    }
  });

  return regions;
}

export function cloneRegionShape(region: RegionShape): RegionShape {
  if (region.type === 'circle') {
    return { type: 'circle', lat: region.lat, lng: region.lng, radius: region.radius };
  }

  return {
    type: 'polygon',
    points: region.points.map((point) => ({ lat: point.lat, lng: point.lng })),
  };
}

function numbersApproximatelyEqual(a: number, b: number, epsilon = COORDINATE_EPSILON): boolean {
  return Math.abs(a - b) <= epsilon;
}

export function regionsAreEqual(
  first: readonly RegionShape[],
  second: readonly RegionShape[],
  epsilon = COORDINATE_EPSILON,
): boolean {
  if (first.length !== second.length) {
    return false;
  }

  return first.every((region, index) => {
    const other = second[index];
    if (!other || region.type !== other.type) {
      return false;
    }

    if (region.type === 'circle') {
      return (
        numbersApproximatelyEqual(region.lat, other.lat, epsilon) &&
        numbersApproximatelyEqual(region.lng, other.lng, epsilon) &&
        numbersApproximatelyEqual(region.radius, other.radius, epsilon)
      );
    }

    if (region.points.length !== other.points.length) {
      return false;
    }

    return region.points.every((point, pointIndex) => {
      const otherPoint = other.points[pointIndex];
      return (
        !!otherPoint &&
        numbersApproximatelyEqual(point.lat, otherPoint.lat, epsilon) &&
        numbersApproximatelyEqual(point.lng, otherPoint.lng, epsilon)
      );
    });
  });
}

function haversineDistanceMeters(a: RegionPoint, b: RegionPoint): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const deltaLat = ((b.lat - a.lat) * Math.PI) / 180;
  const deltaLng = ((b.lng - a.lng) * Math.PI) / 180;

  const haversine =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);

  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function isPointInsidePolygon(point: RegionPoint, polygon: RegionPolygon): boolean {
  const { points } = polygon;
  if (points.length < 3) {
    return false;
  }

  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const vertex = points[i];
    const previous = points[j];

    const intersects =
      (vertex.lat > point.lat) !== (previous.lat > point.lat) &&
      point.lng <
        ((previous.lng - vertex.lng) * (point.lat - vertex.lat)) /
          (previous.lat - vertex.lat || Number.EPSILON) +
          vertex.lng;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

export function isPointInsideRegion(point: RegionPoint, region: RegionShape): boolean {
  if (region.type === 'circle') {
    const distance = haversineDistanceMeters(point, region);
    return distance <= region.radius;
  }

  return isPointInsidePolygon(point, region);
}

export function isPointInsideRegions(point: RegionPoint, regions: readonly RegionShape[]): boolean {
  if (regions.length === 0) {
    return true;
  }

  return regions.some((region) => isPointInsideRegion(point, region));
}
