import { ArcgisFeature, GeoCircle } from '../types';

const EARTH_RADIUS_METERS = 6371000;

export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

export function featureWithinCircles(
  feature: ArcgisFeature,
  circles: GeoCircle[]
): boolean {
  if (!feature.geometry || !circles.length) {
    return circles.length === 0;
  }

  return circles.some((circle) => {
    const distance = haversineDistance(
      feature.geometry!.y,
      feature.geometry!.x,
      circle.center.lat,
      circle.center.lng
    );
    return distance <= circle.radiusMeters;
  });
}

export function filterByCircles(
  features: ArcgisFeature[],
  circles: GeoCircle[]
): ArcgisFeature[] {
  if (!circles.length) {
    return features;
  }

  return features.filter((feature) => featureWithinCircles(feature, circles));
}
