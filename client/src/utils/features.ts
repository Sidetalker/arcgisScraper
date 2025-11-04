import { ArcgisFeature } from '../types';

const featureIdCache = new WeakMap<ArcgisFeature, string>();
let fallbackCounter = 0;

type AttributeValue = string | number | null | undefined;

function pickAttribute(
  attributes: Record<string, unknown>,
  keys: string[]
): AttributeValue {
  for (const key of keys) {
    const value = attributes[key];
    if (value !== undefined && value !== null && value !== '') {
      return value as AttributeValue;
    }
  }
  return undefined;
}

export function getFeatureId(feature: ArcgisFeature): string {
  const existing = featureIdCache.get(feature);
  if (existing) {
    return existing;
  }

  const attributes = feature.attributes ?? {};
  const candidate =
    pickAttribute(attributes, [
      'OBJECTID',
      'ObjectID',
      'OBJECTID_1',
      'OBJECT_ID',
      'FID',
      'GlobalID',
      'GlobalId',
      'GlobalID_1',
      'HC_RegistrationsOriginalCleaned',
      'HC_RegistrationOriginalCleaned',
      'PropertyScheduleText',
    ]) ??
    (feature.geometry ? `${feature.geometry.x},${feature.geometry.y}` : undefined);

  const id = candidate !== undefined && candidate !== null
    ? String(candidate)
    : `feature-${++fallbackCounter}`;

  featureIdCache.set(feature, id);
  return id;
}
