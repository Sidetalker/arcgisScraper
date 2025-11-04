import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GeoJSON, MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';
import type { FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';

type LeafletEditTooltip = {
  updateContent: (content: { text: string; subtext: string }) => void;
};

type LeafletCircleEditor = {
  _moveMarker: L.Marker;
  _map: L.Map & {
    distance: (from: L.LatLngExpression, to: L.LatLngExpression) => number;
    _editTooltip?: LeafletEditTooltip;
  };
  _shape: L.Circle;
  options?: {
    feet?: boolean;
    nautic?: boolean;
  };
};

const leafletWithDraw = L as typeof L & {
  Edit?: {
    Circle?: {
      prototype: {
        _resize?: (this: LeafletCircleEditor, latlng: L.LatLng) => void;
      };
    };
  };
  GeometryUtil?: {
    isVersion07x?: () => boolean;
    readableDistance?: (
      radius: number,
      isMetric?: boolean,
      useFeet?: boolean,
      useNautic?: boolean,
    ) => string;
    readableArea?: (
      area: number,
      isMetric?: boolean | string | string[],
      precision?: Record<string, number | undefined>,
    ) => string;
    formattedNumber?: (value: number, precision?: number | { decimals?: number }) => string;
  };
  Draw?: {
    Event: {
      EDITRESIZE: string;
    };
    Polygon?: typeof L.Draw.Polygon;
    Circle?: typeof L.Draw.Circle;
  };
  drawLocal?: {
    draw: {
      toolbar?: {
        buttons?: {
          circle?: string;
          polygon?: string;
        };
      };
      handlers: {
        circle: {
          radius: string;
        };
        polygon?: {
          tooltip?: {
            start?: string;
            cont?: string;
            end?: string;
          };
        };
      };
    };
    edit: {
      toolbar?: {
        buttons?: {
          edit?: string;
          remove?: string;
        };
      };
      handlers: {
        edit: {
          tooltip: {
            text: string;
            subtext: string;
          };
        };
      };
    };
  };
};

const circleEditPrototype = leafletWithDraw.Edit?.Circle?.prototype;

if (circleEditPrototype) {
  circleEditPrototype._resize = function patchLeafletDrawResize(this: LeafletCircleEditor, latlng: L.LatLng) {
    const moveLatLng = this._moveMarker.getLatLng();
    const geometryUtil = leafletWithDraw.GeometryUtil;
    const isV07 =
      geometryUtil?.isVersion07x?.() ?? false;

    const radiusValue = isV07
      ? moveLatLng.distanceTo(latlng)
      : this._map.distance(moveLatLng, latlng);

    this._shape.setRadius(radiusValue);

    const tooltipStrings = leafletWithDraw.drawLocal?.edit?.handlers?.edit?.tooltip;
    const radiusLabel = leafletWithDraw.drawLocal?.draw?.handlers?.circle?.radius;

    if (this._map._editTooltip && tooltipStrings && radiusLabel) {
      this._map._editTooltip.updateContent({
        text: `${tooltipStrings.subtext}<br />${tooltipStrings.text}`,
        subtext: `${radiusLabel}: ${
          geometryUtil?.readableDistance?.(
            radiusValue,
            true,
            this.options?.feet,
            this.options?.nautic,
          ) ?? radiusValue.toFixed(2)
        }`,
      });
    }

    this._map.fire(leafletWithDraw.Draw?.Event.EDITRESIZE ?? 'draw:editresize', {
      layer: this._shape,
    });
  };
}

const geometryUtil = leafletWithDraw.GeometryUtil;

if (geometryUtil) {
  type AreaPrecision = Record<string, number | undefined>;

  const defaultPrecision: AreaPrecision = {
    km: 2,
    ha: 2,
    m: 0,
    acres: 2,
  };

  const formatNumber =
    geometryUtil.formattedNumber?.bind(geometryUtil) ??
    ((value: number, precision?: number | { decimals?: number }) => {
      if (typeof precision === 'number') {
        return value.toFixed(precision);
      }

      if (precision && typeof (precision as { decimals?: number }).decimals === 'number') {
        return value.toFixed((precision as { decimals?: number }).decimals ?? 0);
      }

      return value.toString();
    });

  geometryUtil.readableArea = (area, metricOrUnits = true, precisionOverrides) => {
    const precision = L.Util.extend(
      {},
      defaultPrecision,
      (precisionOverrides ?? {}) as AreaPrecision,
    ) as AreaPrecision;

    const format = (value: number, digits: number | undefined, suffix: string) =>
      `${formatNumber(value, digits)} ${suffix}`;

    if (metricOrUnits) {
      let units: string[] = ['ha', 'm'];

      if (typeof metricOrUnits === 'string') {
        units = [metricOrUnits];
      } else if (Array.isArray(metricOrUnits)) {
        units = metricOrUnits;
      }

      if (area >= 1_000_000 && units.includes('km')) {
        return format(area * 1e-6, precision.km, 'km²');
      }

      if (area >= 10_000 && units.includes('ha')) {
        return format(area * 1e-4, precision.ha, 'ha');
      }

      return format(area, precision.m, 'm²');
    }

    const acresPrecision = precision.acres ?? precision.ac;
    return format(area * 0.000247105, acresPrecision, 'acres');
  };
}

const drawLocal = leafletWithDraw.drawLocal;
if (drawLocal) {
  const toolbarButtons = drawLocal.draw?.toolbar?.buttons;
  if (toolbarButtons) {
    toolbarButtons.polygon = 'Draw search polygon';
    toolbarButtons.circle = 'Draw search circle';
  }

  const polygonTooltip = drawLocal.draw?.handlers?.polygon?.tooltip;
  if (polygonTooltip) {
    polygonTooltip.start = 'Click to start outlining your search area';
    polygonTooltip.cont = 'Click to continue drawing the polygon';
    polygonTooltip.end = 'Click the first point to finish the polygon';
  }

  const editButtons = drawLocal.edit?.toolbar?.buttons;
  if (editButtons) {
    editButtons.edit = 'Adjust shapes';
    editButtons.remove = 'Delete shapes';
  }
}

import type { ListingRecord, RegionShape } from '@/types';
import summitCountyGeoJsonRaw from '@/assets/summit_county.geojson?raw';
import { fetchZoneMetrics, type ZoneMetric } from '@/services/listingMetrics';
import { supabase } from '@/services/supabaseClient';

import './RegionMap.css';

type RegionMapProps = {
  regions: RegionShape[];
  onRegionsChange: (regions: RegionShape[]) => void;
  listings?: ListingRecord[];
  allListings?: ListingRecord[];
  onListingSelect?: (listingId: string) => void;
  totalListingCount?: number;
};

const DEFAULT_CENTER: [number, number] = [39.6, -106.07];
const DEFAULT_ZOOM = 10;

type MapLayerType = 'map' | 'satellite' | 'terrain';

type MapLayerConfig = {
  name: string;
  url: string;
  attribution: string;
  maxZoom?: number;
};

const MAP_LAYERS: Record<MapLayerType, MapLayerConfig> = {
  map: {
    name: 'Street Map',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  },
  satellite: {
    name: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri',
    maxZoom: 19,
  },
  terrain: {
    name: 'Terrain',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenTopoMap contributors',
    maxZoom: 17,
  },
};

const LAYER_ORDER: readonly MapLayerType[] = ['map', 'satellite', 'terrain'] as const;

const LAYER_ICONS: Record<MapLayerType, string> = {
  map: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 6.75 9 4.5l6 2.25 6-2.25v13.5l-6 2.25-6-2.25-6 2.25z" />
      <path d="M9 4.5v13.5" />
      <path d="M15 6.75v13.5" />
    </svg>
  `,
  satellite: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="10.5" cy="13.5" r="4.25" />
      <path d="M7.25 4.5 11 8.25" />
      <path d="m13.75 3 3.25 3.25" />
      <path d="m16.5 9.5 4.5-4.5" />
      <path d="M3 16.5 8 21.5" />
    </svg>
  `,
  terrain: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="m3 18 6.5-11 4.25 6 3-4.5L21 18z" />
      <path d="m9.5 11 2 3" />
    </svg>
  `,
};

function getNextLayer(currentLayer: MapLayerType): MapLayerType {
  const currentIndex = LAYER_ORDER.indexOf(currentLayer);
  const nextIndex = (currentIndex + 1) % LAYER_ORDER.length;
  return LAYER_ORDER[nextIndex];
}

type SummitCountyFeatureCollection = FeatureCollection<Polygon | MultiPolygon>;

type SummitCountyBoundaryProperties = {
  geoid?: string;
  GEOID?: string;
  name?: string;
  boundarySource?: string;
  [key: string]: unknown;
};

type SummitCountyFeature = SummitCountyFeatureCollection['features'][number] & {
  properties?: SummitCountyBoundaryProperties;
};

const SUMMIT_COUNTY_FIPS = '08117';
const SUMMIT_BOUNDARY_SOURCE_URL =
  'https://cdn.jsdelivr.net/gh/plotly/datasets@master/geojson-counties-fips.json';

const IS_TEST_ENV = import.meta.env.MODE === 'test';

const SUMMIT_OVERLAY_STYLE: L.PathOptions = {
  color: '#1f78b4',
  weight: 2,
  fillColor: '#1f78b4',
  fillOpacity: 0.05,
};

const SUMMIT_OVERLAY_MASK_STYLE: L.PathOptions = {
  color: '#001b2b',
  weight: 0,
  fillColor: '#001b2b',
  fillOpacity: 0.35,
  fillRule: 'evenodd',
};

type LinearRing = Position[];

const WORLD_MASK_OUTER_RING: LinearRing = [
  [-180, -90],
  [-180, 90],
  [180, 90],
  [180, -90],
  [-180, -90],
];

function extractOuterRings(
  geometry: Polygon | MultiPolygon | null | undefined,
): LinearRing[] {
  if (!geometry) {
    return [];
  }

  if (geometry.type === 'Polygon') {
    return geometry.coordinates.length > 0 ? [geometry.coordinates[0]] : [];
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates
      .map((polygonCoordinates) => polygonCoordinates[0])
      .filter((ring): ring is LinearRing => Array.isArray(ring) && ring.length > 0);
  }

  return [];
}

function createInvertedMask(
  boundary: SummitCountyFeatureCollection | null,
): FeatureCollection<Polygon> | null {
  if (!boundary?.features?.length) {
    return null;
  }

  const holes: LinearRing[] = boundary.features.flatMap((feature) => {
    if (!feature || typeof feature !== 'object') {
      return [];
    }
    return extractOuterRings(feature.geometry);
  });

  if (holes.length === 0) {
    return null;
  }

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          mask: true,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [WORLD_MASK_OUTER_RING, ...holes],
        },
      },
    ],
  };
}

const LOCAL_SUMMIT_COUNTY_OVERLAY: SummitCountyFeatureCollection | null = (() => {
  try {
    const geometry = JSON.parse(summitCountyGeoJsonRaw) as SummitCountyFeatureCollection;
    return Array.isArray(geometry.features) && geometry.features.length > 0 ? geometry : null;
  } catch (error) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console -- surface parsing issues for the bundled fallback asset
      console.warn('Failed to parse local Summit County boundary GeoJSON', error);
    }
    return null;
  }
})();

function useSummitCountyBoundary(): SummitCountyFeatureCollection | null {
  const [boundary, setBoundary] = useState<SummitCountyFeatureCollection | null>(
    LOCAL_SUMMIT_COUNTY_OVERLAY,
  );

  useEffect(() => {
    let cancelled = false;

    async function loadBoundary(): Promise<void> {
      try {
        const response = await fetch(SUMMIT_BOUNDARY_SOURCE_URL, {
          cache: 'force-cache',
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch county boundaries: ${response.status}`);
        }

        const dataset = (await response.json()) as FeatureCollection<Polygon | MultiPolygon> & {
          features: SummitCountyFeature[];
        };

        const summitFeature = dataset.features.find((feature) => {
          if (!feature) {
            return false;
          }

          if (feature.id === SUMMIT_COUNTY_FIPS) {
            return true;
          }

          const properties = feature.properties ?? {};
          const candidateGeoid =
            typeof properties.geoid === 'string'
              ? properties.geoid
              : typeof properties.GEOID === 'string'
                ? properties.GEOID
                : undefined;

          return candidateGeoid === SUMMIT_COUNTY_FIPS;
        });

        if (!summitFeature?.geometry || cancelled) {
          return;
        }

        const nextBoundary: SummitCountyFeatureCollection = {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {
                name: 'Summit County',
                geoid: SUMMIT_COUNTY_FIPS,
                boundarySource: 'remote',
                ...(summitFeature.properties ?? {}),
              },
              geometry: summitFeature.geometry,
            },
          ],
        };

        if (!cancelled) {
          setBoundary(nextBoundary);
        }
      } catch (error) {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console -- surface network issues in development only
          console.warn('Failed to load Summit County boundary overlay', error);
        }
      }
    }

    void loadBoundary();

    return () => {
      cancelled = true;
    };
  }, []);

  return boundary;
}

function SummitCountyOverlay(): JSX.Element | null {
  const overlayGeometry = useSummitCountyBoundary();
  const overlayRef = useRef<L.GeoJSON | null>(null);
  const maskGeometry = useMemo(() => createInvertedMask(overlayGeometry), [overlayGeometry]);
  const map = useMap();
  const fittedSourceRef = useRef<string | null>(null);

  useEffect(() => {
    if (IS_TEST_ENV) {
      return;
    }

    if (!overlayGeometry || !overlayRef.current) {
      return;
    }

    const bounds = overlayRef.current.getBounds();
    if (!bounds.isValid()) {
      return;
    }

    const overlaySource =
      overlayGeometry.features[0]?.properties &&
      typeof overlayGeometry.features[0].properties === 'object'
        ? (overlayGeometry.features[0].properties as SummitCountyBoundaryProperties)
            .boundarySource ?? 'unknown'
        : 'unknown';

    if (fittedSourceRef.current === overlaySource) {
      return;
    }

    const mapSize = map.getSize();
    const paddingFraction = 0.15;
    const paddingValue = Math.round(Math.min(mapSize.x, mapSize.y) * paddingFraction);

    map.fitBounds(bounds, {
      padding: [paddingValue, paddingValue],
    });

    overlayRef.current.bringToBack();
    fittedSourceRef.current = overlaySource;
  }, [map, overlayGeometry]);

  if (IS_TEST_ENV || !overlayGeometry) {
    return null;
  }

  return (
    <>
      {maskGeometry ? (
        <GeoJSON data={maskGeometry} style={() => SUMMIT_OVERLAY_MASK_STYLE} interactive={false} />
      ) : null}
      <GeoJSON
        data={overlayGeometry}
        ref={(instance) => {
          overlayRef.current = instance;
        }}
        style={() => SUMMIT_OVERLAY_STYLE}
        interactive={false}
      />
    </>
  );
}

const REGION_STYLE: L.PathOptions = {
  color: '#2563eb',
  fillColor: '#3b82f6',
  fillOpacity: 0.2,
  weight: 2,
};

const ZONE_COLOR_PALETTE = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#22c55e',
  '#14b8a6',
  '#0ea5e9',
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#f472b6',
];

type ZoningDistrictSummary = {
  zone: string;
  key: string;
  count: number;
  color: string;
  hoverColor: string;
  outlineColor: string;
  glowColor: string;
  glowHoverColor: string;
  markerFill: string;
  markerStroke: string;
  markerActiveFill: string;
  markerActiveStroke: string;
};

function clampChannel(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(255, Math.max(0, Math.round(value)));
}

function normaliseHexColor(color: string): string | null {
  const trimmed = color.trim();
  if (!trimmed) {
    return null;
  }

  const hex = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (!/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex)) {
    return null;
  }

  if (hex.length === 3) {
    const expanded = hex
      .split('')
      .map((char) => char + char)
      .join('');
    return `#${expanded.toLowerCase()}`;
  }

  return `#${hex.toLowerCase()}`;
}

function toHexChannel(value: number): string {
  return clampChannel(value).toString(16).padStart(2, '0');
}

function adjustHexColor(color: string, amount: number): string {
  const normalised = normaliseHexColor(color);
  if (!normalised) {
    return color;
  }

  const limited = Math.max(-1, Math.min(1, amount));
  const red = parseInt(normalised.slice(1, 3), 16);
  const green = parseInt(normalised.slice(3, 5), 16);
  const blue = parseInt(normalised.slice(5, 7), 16);

  const adjustChannel = (channel: number) => {
    if (limited < 0) {
      return clampChannel(channel * (1 + limited));
    }
    return clampChannel(channel + (255 - channel) * limited);
  };

  const r = adjustChannel(red);
  const g = adjustChannel(green);
  const b = adjustChannel(blue);

  return `#${toHexChannel(r)}${toHexChannel(g)}${toHexChannel(b)}`;
}

function lightenColor(color: string, amount: number): string {
  return adjustHexColor(color, Math.abs(amount));
}

function darkenColor(color: string, amount: number): string {
  return adjustHexColor(color, -Math.abs(amount));
}

function normaliseZoneKey(zone: string | null | undefined): string | null {
  if (!zone) {
    return null;
  }
  const trimmed = zone.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.toLowerCase();
}

type ZoneCountEntry = { key: string; zone: string; count: number };

function createZoneSummaries(entries: ZoneCountEntry[]): ZoningDistrictSummary[] {
  return entries
    .filter((entry) => entry.count > 100)
    .sort((a, b) => b.count - a.count)
    .slice(0, ZONE_COLOR_PALETTE.length)
    .map((entry, index) => {
      const paletteColor = ZONE_COLOR_PALETTE[index % ZONE_COLOR_PALETTE.length];
      const glowColor = lightenColor(paletteColor, 0.15);
      const glowHoverColor = darkenColor(paletteColor, 0.2);
      const markerFill = lightenColor(paletteColor, 0.1);
      const markerStroke = darkenColor(paletteColor, 0.35);
      const markerActiveFill = darkenColor(paletteColor, 0.05);
      const markerActiveStroke = darkenColor(paletteColor, 0.45);

      return {
        zone: entry.zone,
        key: entry.key,
        count: entry.count,
        color: paletteColor,
        hoverColor: darkenColor(paletteColor, 0.25),
        outlineColor: markerStroke,
        glowColor,
        glowHoverColor,
        markerFill,
        markerStroke,
        markerActiveFill,
        markerActiveStroke,
      } satisfies ZoningDistrictSummary;
    });
}

function computeTopZoningDistrictsFromListings(listings: ListingRecord[]): ZoningDistrictSummary[] {
  const counts = new Map<string, ZoneCountEntry>();

  listings.forEach((listing) => {
    const key = normaliseZoneKey(listing.zone);
    if (!key) {
      return;
    }

    const trimmedZone = listing.zone?.trim() ?? '';
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
      if (trimmedZone.length > existing.zone.length) {
        existing.zone = trimmedZone;
      }
    } else {
      counts.set(key, {
        zone: trimmedZone,
        count: 1,
        key,
      });
    }
  });

  return createZoneSummaries(Array.from(counts.values()));
}

function computeTopZoningDistrictsFromMetrics(metrics: ZoneMetric[]): ZoningDistrictSummary[] {
  const entries: ZoneCountEntry[] = [];

  metrics.forEach((metric) => {
    const key = normaliseZoneKey(metric.zone);
    if (!key) {
      return;
    }

    const trimmedZone = metric.zone.trim();
    entries.push({
      key,
      zone: trimmedZone,
      count: metric.totalListings,
    });
  });

  return createZoneSummaries(entries);
}

function toRegionShape(layer: L.Layer): RegionShape | null {
  if (layer instanceof L.Circle) {
    const center = layer.getLatLng();
    const radius = layer.getRadius();
    if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng) || !Number.isFinite(radius)) {
      return null;
    }
    return { type: 'circle', lat: center.lat, lng: center.lng, radius };
  }

  if (layer instanceof L.Polygon) {
    const latLngs = layer.getLatLngs();
    const ring = Array.isArray(latLngs[0]) ? (latLngs[0] as L.LatLng[]) : (latLngs as unknown as L.LatLng[]);
    const points = ring
      .map((latLng) => ({ lat: latLng.lat, lng: latLng.lng }))
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));

    if (points.length < 3) {
      return null;
    }

    const first = points[0];
    const last = points[points.length - 1];
    if (Math.abs(first.lat - last.lat) < 1e-9 && Math.abs(first.lng - last.lng) < 1e-9) {
      points.pop();
    }

    if (points.length < 3) {
      return null;
    }

    return { type: 'polygon', points };
  }

  return null;
}

function createLayerFromRegion(region: RegionShape): L.Circle | L.Polygon {
  if (region.type === 'circle') {
    return L.circle([region.lat, region.lng], {
      ...REGION_STYLE,
      radius: region.radius,
    });
  }

  const latLngs = region.points.map<[number, number]>((point) => [point.lat, point.lng]);
  return L.polygon(latLngs, {
    ...REGION_STYLE,
    smoothFactor: 0.2,
  });
}

function collectRegions(featureGroup: L.FeatureGroup): RegionShape[] {
  const results: RegionShape[] = [];
  featureGroup.eachLayer((layer) => {
    const shape = toRegionShape(layer);
    if (shape) {
      results.push(shape);
    }
  });
  return results;
}

function getUniqueOwners(listing: ListingRecord): string[] {
  const owners = new Set<string>();
  listing.ownerNames.forEach((name) => {
    const trimmed = name.trim();
    if (trimmed) {
      owners.add(trimmed);
    }
  });

  const fallbackOwner = listing.ownerName?.trim();
  if (owners.size === 0 && fallbackOwner) {
    owners.add(fallbackOwner);
  }

  return Array.from(owners);
}

function normaliseDetailUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function splitLines(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

type ListingSelectionPanelProps = {
  listing: ListingRecord | null;
  zoneHighlight: ZoningDistrictSummary | null;
  hasListings: boolean;
  totalListingCount: number;
};

function ListingSelectionPanel({ listing, zoneHighlight, hasListings, totalListingCount }: ListingSelectionPanelProps): JSX.Element {
  if (!listing && zoneHighlight) {
    const formattedCount = zoneHighlight.count.toLocaleString();
    const countLabel = zoneHighlight.count === 1 ? 'property' : 'properties';

    return (
      <div className="region-map__selection region-map__selection--zone" aria-live="polite">
        <div className="region-map__selection-zone">
          <div className="region-map__selection-zone-header">
            <span
              className="region-map__selection-zone-swatch"
              aria-hidden="true"
              style={{
                backgroundColor: zoneHighlight.markerActiveFill,
                boxShadow: `0 0 0 1px ${zoneHighlight.markerStroke}`,
              }}
            />
            <div className="region-map__selection-zone-heading">
              <p className="region-map__selection-zone-label">Zoning district</p>
              <h3 className="region-map__selection-zone-name">{zoneHighlight.zone}</h3>
            </div>
          </div>
          <p className="region-map__selection-zone-count">
            {formattedCount} {countLabel} in this district
          </p>
          <p className="region-map__selection-zone-description">
            Move closer to a property marker to view its listing details.
          </p>
        </div>
      </div>
    );
  }

  if (!listing) {
    const formattedCount = totalListingCount.toLocaleString();
    const pluralised = totalListingCount === 1 ? 'property matches' : 'properties match';
    const countMessage =
      totalListingCount === 0
        ? 'No properties match the current filters.'
        : `${formattedCount} ${pluralised} the current filters.`;
    return (
      <div className="region-map__selection region-map__selection--empty" aria-live="polite">
        <p className="region-map__selection-empty-primary">
          {hasListings
            ? 'Hover over a property marker to see details.'
            : 'Draw a region or adjust filters to find properties.'}
        </p>
        <p className="region-map__selection-empty-secondary">{countMessage}</p>
        <div className="region-map__selection-empty-hints">
          <p>Need somewhere to start?</p>
          <ul>
            <li>Use the filters to narrow down complexes or owners.</li>
            <li>Draw regions on the map to focus on specific neighborhoods.</li>
            <li>Hover any marker to preview the property before jumping to the table.</li>
          </ul>
        </div>
      </div>
    );
  }

  const title =
    listing.complex?.trim() ||
    listing.physicalAddress?.trim() ||
    listing.ownerName?.trim() ||
    listing.scheduleNumber?.trim() ||
    'Listing';

  const owners = getUniqueOwners(listing);
  const mailingAddressLines = splitLines(listing.mailingAddress);
  const detailUrl = normaliseDetailUrl(listing.publicDetailUrl);

  return (
    <div className="region-map__selection" aria-live="polite">
      <div className="region-map__selection-header">
        <div className="region-map__selection-heading">
          <h3 className="region-map__selection-title">{title}</h3>
        </div>
        {detailUrl ? (
          <a
            href={detailUrl}
            target="_blank"
            rel="noreferrer"
            className="region-map__selection-link"
            aria-label="Open listing details in a new tab"
          >
            <svg className="region-map__selection-link-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="12" cy="8" r="1" fill="currentColor" />
              <path
                d="M11.25 10.5c0-.414.336-.75.75-.75s.75.336.75.75v5.25a.75.75 0 0 1-1.5 0Z"
                fill="currentColor"
              />
            </svg>
            <span>Official details</span>
          </a>
        ) : null}
      </div>

      <dl className="region-map__selection-grid">
        {owners.length ? (
          <div>
            <dt>Owner(s)</dt>
            <dd>{owners.join(', ')}</dd>
          </div>
        ) : null}
        {listing.physicalAddress ? (
          <div>
            <dt>Physical address</dt>
            <dd>{listing.physicalAddress}</dd>
          </div>
        ) : null}
        {listing.scheduleNumber ? (
          <div>
            <dt>Schedule #</dt>
            <dd>{listing.scheduleNumber}</dd>
          </div>
        ) : null}
        {listing.mailingAddress ? (
          <div>
            <dt>Mailing address</dt>
            <dd>
              {mailingAddressLines.length > 0
                ? mailingAddressLines.map((line, index) => <span key={index}>{line}</span>)
                : listing.mailingAddress}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

ListingSelectionPanel.displayName = 'ListingSelectionPanel';

type DrawManagerProps = {
  regions: RegionShape[];
  onRegionsChange: (regions: RegionShape[]) => void;
  showAllProperties: boolean;
  onToggleShowAll: () => void;
  currentLayer: MapLayerType;
  onLayerChange: (layer: MapLayerType) => void;
};

type MapToolbarProps = {
  onDrawPolygon: () => void;
  onDrawCircle: () => void;
  onClearRegions: () => void;
  onFitRegions: () => void;
  hasRegions: boolean;
  activeTool: 'polygon' | 'circle' | null;
  showAllProperties: boolean;
  onToggleShowAll: () => void;
  currentLayer: MapLayerType;
  onLayerChange: (layer: MapLayerType) => void;
};

function MapToolbar({
  onDrawPolygon,
  onDrawCircle,
  onClearRegions,
  onFitRegions,
  hasRegions,
  activeTool,
  showAllProperties,
  onToggleShowAll,
  currentLayer,
  onLayerChange,
}: MapToolbarProps): null {
  const map = useMap();
  const buttonRefs = useRef<
    | {
        clearButton?: HTMLButtonElement;
        fitButton?: HTMLButtonElement;
        polygonButton?: HTMLButtonElement;
        circleButton?: HTMLButtonElement;
        toggleAllButton?: HTMLButtonElement;
        layerButtons?: Record<MapLayerType, HTMLButtonElement>;
      }
    | null
  >(null);

  useEffect(() => {
    const toolbarControl = new L.Control({ position: 'topright' });
    toolbarControl.onAdd = () => {
      const container = L.DomUtil.create('div', 'leaflet-bar region-map__toolbar') as HTMLDivElement;
      container.setAttribute('role', 'group');
      container.setAttribute('aria-label', 'Drawing controls');

      const polygonButton = L.DomUtil.create(
        'button',
        'region-map__toolbar-button',
        container,
      ) as HTMLButtonElement;
      polygonButton.type = 'button';
      polygonButton.title = 'Draw a custom polygon';
      polygonButton.textContent = 'Draw polygon';
      polygonButton.setAttribute('aria-pressed', 'false');
      polygonButton.addEventListener('click', (event) => {
        event.preventDefault();
        onDrawPolygon();
      });

      const circleButton = L.DomUtil.create(
        'button',
        'region-map__toolbar-button',
        container,
      ) as HTMLButtonElement;
      circleButton.type = 'button';
      circleButton.title = 'Draw a circular search area';
      circleButton.textContent = 'Draw circle';
      circleButton.setAttribute('aria-pressed', 'false');
      circleButton.addEventListener('click', (event) => {
        event.preventDefault();
        onDrawCircle();
      });

      const fitButton = L.DomUtil.create(
        'button',
        'region-map__toolbar-button',
        container,
      ) as HTMLButtonElement;
      fitButton.type = 'button';
      fitButton.title = 'Zoom the map to your drawn regions';
      fitButton.textContent = 'Zoom to shapes';
      fitButton.dataset.action = 'fit';
      fitButton.addEventListener('click', (event) => {
        event.preventDefault();
        if (!fitButton.disabled) {
          onFitRegions();
        }
      });

      const clearButton = L.DomUtil.create(
        'button',
        'region-map__toolbar-button',
        container,
      ) as HTMLButtonElement;
      clearButton.type = 'button';
      clearButton.title = 'Remove all drawn regions';
      clearButton.textContent = 'Clear shapes';
      clearButton.dataset.action = 'clear';
      clearButton.addEventListener('click', (event) => {
        event.preventDefault();
        if (!clearButton.disabled) {
          onClearRegions();
        }
      });

      const toggleAllButton = L.DomUtil.create(
        'button',
        'region-map__toolbar-button',
        container,
      ) as HTMLButtonElement;
      toggleAllButton.type = 'button';
      toggleAllButton.title = 'Show all properties or only those within regions';
      toggleAllButton.textContent = 'Show all properties';
      toggleAllButton.dataset.action = 'toggle-all';
      toggleAllButton.setAttribute('aria-pressed', 'false');
      toggleAllButton.addEventListener('click', (event) => {
        event.preventDefault();
        onToggleShowAll();
      });

      const layerToggleGroup = L.DomUtil.create(
        'div',
        'region-map__layer-toggle',
        container,
      ) as HTMLDivElement;
      layerToggleGroup.setAttribute('role', 'group');
      layerToggleGroup.setAttribute('aria-label', 'Base map layer');

      const layerButtons: Record<MapLayerType, HTMLButtonElement> = {} as Record<
        MapLayerType,
        HTMLButtonElement
      >;
      LAYER_ORDER.forEach((layerKey) => {
        const button = L.DomUtil.create(
          'button',
          'region-map__layer-button',
          layerToggleGroup,
        ) as HTMLButtonElement;
        button.type = 'button';
        button.title = MAP_LAYERS[layerKey].name;
        button.setAttribute('aria-label', MAP_LAYERS[layerKey].name);
        button.setAttribute('data-layer', layerKey);
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', (event) => {
          event.preventDefault();
          onLayerChange(layerKey);
        });

        const content = document.createElement('span');
        content.className = 'region-map__layer-button-content';

        const iconWrapper = document.createElement('span');
        iconWrapper.className = 'region-map__layer-button-icon';
        iconWrapper.innerHTML = LAYER_ICONS[layerKey];

        content.append(iconWrapper);
        button.appendChild(content);

        layerButtons[layerKey] = button;
      });

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      [clearButton, fitButton].forEach((button) => {
        button.disabled = true;
        button.setAttribute('aria-disabled', 'true');
        button.classList.add('region-map__toolbar-button--disabled');
      });

      buttonRefs.current = {
        clearButton,
        fitButton,
        polygonButton,
        circleButton,
        toggleAllButton,
        layerButtons,
      };

      return container;
    };

    toolbarControl.addTo(map);

    return () => {
      buttonRefs.current = null;
      toolbarControl.remove();
    };
  }, [map, onClearRegions, onDrawCircle, onDrawPolygon, onFitRegions, onToggleShowAll, onLayerChange]);

  useEffect(() => {
    const refs = buttonRefs.current;
    if (!refs) {
      return;
    }

    const buttons = [refs.clearButton, refs.fitButton];
    buttons.forEach((button) => {
      if (!button) {
        return;
      }
      const disabled = !hasRegions;
      button.disabled = disabled;
      button.setAttribute('aria-disabled', disabled ? 'true' : 'false');
      button.classList.toggle('region-map__toolbar-button--disabled', disabled);
    });
  }, [hasRegions]);

  useEffect(() => {
    const refs = buttonRefs.current;
    if (!refs || !refs.toggleAllButton) {
      return;
    }

    refs.toggleAllButton.classList.toggle('region-map__toolbar-button--active', showAllProperties);
    refs.toggleAllButton.setAttribute('aria-pressed', showAllProperties ? 'true' : 'false');
  }, [showAllProperties]);

  useEffect(() => {
    const refs = buttonRefs.current;
    if (!refs) {
      return;
    }

    const toggleActiveState = (button: HTMLButtonElement | undefined, isActive: boolean) => {
      if (!button) {
        return;
      }
      button.classList.toggle('region-map__toolbar-button--active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    };

    toggleActiveState(refs.polygonButton, activeTool === 'polygon');
    toggleActiveState(refs.circleButton, activeTool === 'circle');
  }, [activeTool]);

  useEffect(() => {
    const refs = buttonRefs.current;
    if (!refs || !refs.layerButtons) {
      return;
    }

    LAYER_ORDER.forEach((layerKey) => {
      const button = refs.layerButtons?.[layerKey];
      if (!button) {
        return;
      }

      const isActive = layerKey === currentLayer;
      button.classList.toggle('region-map__layer-button--active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }, [currentLayer]);

  return null;
}

function DrawManager({
  regions,
  onRegionsChange,
  showAllProperties,
  onToggleShowAll,
  currentLayer,
  onLayerChange,
}: DrawManagerProps): JSX.Element {
  const map = useMap();
  const featureGroupRef = useRef<L.FeatureGroup | null>(null);
  const drawControlRef = useRef<L.Control.Draw | null>(null);
  const polygonDrawerRef = useRef<L.Draw.Polygon | null>(null);
  const circleDrawerRef = useRef<L.Draw.Circle | null>(null);
  const previousCountRef = useRef(0);
  const [activeTool, setActiveTool] = useState<'polygon' | 'circle' | null>(null);

  const initialiseLayers = useCallback(() => {
    if (!featureGroupRef.current) {
      featureGroupRef.current = new L.FeatureGroup();
      map.addLayer(featureGroupRef.current);
    }

    if (!drawControlRef.current && featureGroupRef.current) {
      drawControlRef.current = new L.Control.Draw({
        edit: {
          featureGroup: featureGroupRef.current,
          edit: {
            poly: { allowIntersection: false },
          },
        },
        draw: {
          polygon: false,
          polyline: false,
          rectangle: false,
          circle: false,
          marker: false,
          circlemarker: false,
        },
      });
      map.addControl(drawControlRef.current);
    }
  }, [map]);

  const teardown = useCallback(() => {
    if (drawControlRef.current) {
      map.removeControl(drawControlRef.current);
      drawControlRef.current = null;
    }

    if (featureGroupRef.current) {
      map.removeLayer(featureGroupRef.current);
      featureGroupRef.current = null;
    }
  }, [map]);

  useEffect(() => {
    const drawMap = map as unknown as L.DrawMap;

    polygonDrawerRef.current = new L.Draw.Polygon(drawMap, {
      allowIntersection: false,
      showArea: true,
      shapeOptions: REGION_STYLE,
    });
    circleDrawerRef.current = new L.Draw.Circle(drawMap, {
      shapeOptions: REGION_STYLE,
    });

    return () => {
      polygonDrawerRef.current?.disable();
      circleDrawerRef.current?.disable();
      polygonDrawerRef.current = null;
      circleDrawerRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    initialiseLayers();

    const handleCreated = (event: L.DrawEvents.Created) => {
      if (!featureGroupRef.current) {
        return;
      }

      const layer = event.layer as L.Layer;
      const shape = toRegionShape(layer);
      if (!shape) {
        return;
      }

      featureGroupRef.current.addLayer(layer);
      onRegionsChange(collectRegions(featureGroupRef.current));
    };

    const handleEdited = () => {
      if (!featureGroupRef.current) {
        return;
      }
      onRegionsChange(collectRegions(featureGroupRef.current));
    };

    const handleDeleted = () => {
      if (!featureGroupRef.current) {
        return;
      }
      onRegionsChange(collectRegions(featureGroupRef.current));
    };

    map.on(L.Draw.Event.CREATED, handleCreated);
    map.on(L.Draw.Event.EDITED, handleEdited);
    map.on(L.Draw.Event.DELETED, handleDeleted);

    return () => {
      map.off(L.Draw.Event.CREATED, handleCreated);
      map.off(L.Draw.Event.EDITED, handleEdited);
      map.off(L.Draw.Event.DELETED, handleDeleted);
      teardown();
    };
  }, [initialiseLayers, map, onRegionsChange, teardown]);

  useEffect(() => {
    const handleDrawStart = (event: L.DrawEvents.DrawStart) => {
      const layerType = event.layerType;
      if (layerType === 'polygon' || layerType === 'circle') {
        setActiveTool(layerType);
      } else {
        setActiveTool(null);
      }
    };

    const handleDrawStop = () => {
      setActiveTool(null);
    };

    map.on(L.Draw.Event.DRAWSTART, handleDrawStart);
    map.on(L.Draw.Event.DRAWSTOP, handleDrawStop);

    return () => {
      map.off(L.Draw.Event.DRAWSTART, handleDrawStart);
      map.off(L.Draw.Event.DRAWSTOP, handleDrawStop);
    };
  }, [map]);

  useEffect(() => {
    if (!featureGroupRef.current) {
      return;
    }

    featureGroupRef.current.clearLayers();
    regions.forEach((region) => {
      const layer = createLayerFromRegion(region);
      featureGroupRef.current?.addLayer(layer);
    });
  }, [regions]);

  useEffect(() => {
    const previousCount = previousCountRef.current;
    previousCountRef.current = regions.length;

    if (regions.length === 0 || !featureGroupRef.current) {
      return;
    }

    if (previousCount > 0) {
      return;
    }

    const bounds = new L.LatLngBounds([]);
    featureGroupRef.current.eachLayer((layer) => {
      if ('getBounds' in layer && typeof (layer as L.Circle | L.Polygon).getBounds === 'function') {
        bounds.extend((layer as L.Circle | L.Polygon).getBounds());
      }
    });

    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.3));
    }
  }, [map, regions]);

  const startPolygon = useCallback(() => {
    circleDrawerRef.current?.disable();
    polygonDrawerRef.current?.enable();
  }, []);

  const startCircle = useCallback(() => {
    polygonDrawerRef.current?.disable();
    circleDrawerRef.current?.enable();
  }, []);

  const clearRegions = useCallback(() => {
    if (!featureGroupRef.current) {
      return;
    }
    featureGroupRef.current.clearLayers();
    onRegionsChange([]);
  }, [onRegionsChange]);

  const fitRegions = useCallback(() => {
    if (!featureGroupRef.current) {
      return;
    }

    const bounds = new L.LatLngBounds([]);
    featureGroupRef.current.eachLayer((layer) => {
      if ('getBounds' in layer && typeof (layer as L.Circle | L.Polygon).getBounds === 'function') {
        bounds.extend((layer as L.Circle | L.Polygon).getBounds());
      }
    });

    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.25));
    }
  }, [map]);

  return (
    <MapToolbar
      onDrawPolygon={startPolygon}
      onDrawCircle={startCircle}
      onClearRegions={clearRegions}
      onFitRegions={fitRegions}
      hasRegions={regions.length > 0}
      activeTool={activeTool}
      showAllProperties={showAllProperties}
      onToggleShowAll={onToggleShowAll}
      currentLayer={currentLayer}
      onLayerChange={onLayerChange}
    />
  );
}

type ListingMarkersProps = {
  listings: ListingRecord[];
  zoneStyles: Map<string, ZoningDistrictSummary>;
  onListingSelect?: (listingId: string) => void;
  selectedListingId?: string | null;
  hoveredListingId?: string | null;
  onListingHover?: (listingId: string | null) => void;
  onZoneHover?: (zone: ZoningDistrictSummary | null) => void;
};

function ListingMarkers({
  listings,
  zoneStyles,
  onListingSelect,
  selectedListingId,
  hoveredListingId,
  onListingHover,
  onZoneHover,
}: ListingMarkersProps): null {
  const map = useMap();
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (IS_TEST_ENV) {
      return;
    }

    if (!layerRef.current) {
      layerRef.current = L.layerGroup().addTo(map);
    }
    const layerGroup = layerRef.current;
    layerGroup.clearLayers();

    listings.forEach((listing) => {
      if (listing.latitude === null || listing.longitude === null) {
        return;
      }

      const isSelected = listing.id === selectedListingId;
      const isHovered = listing.id === hoveredListingId;
      const isActive = isSelected || isHovered;

      const zoneKey = normaliseZoneKey(listing.zone);
      const zoneSummary = zoneKey ? zoneStyles.get(zoneKey) ?? null : null;

      const baseFill = zoneSummary?.markerFill ?? '#3b82f6';
      const baseStroke = zoneSummary?.markerStroke ?? '#1d4ed8';
      const activeFill = zoneSummary?.markerActiveFill ?? '#2563eb';
      const activeStroke = zoneSummary?.markerActiveStroke ?? '#1e3a8a';

      const marker = L.circleMarker([listing.latitude, listing.longitude], {
        radius: isActive ? 7 : 5,
        color: isActive ? activeStroke : baseStroke,
        weight: isActive ? 2 : 1.25,
        fillColor: isActive ? activeFill : baseFill,
        fillOpacity: isActive ? 0.95 : 0.85,
        pane: 'markerPane',
      });

      marker.on('click', (event: L.LeafletMouseEvent) => {
        event.originalEvent?.preventDefault?.();
        event.originalEvent?.stopPropagation?.();
        onListingSelect?.(listing.id);
      });

      marker.on('mouseover', () => {
        onZoneHover?.(null);
        onListingHover?.(listing.id);
      });

      marker.on('mouseout', () => {
        onListingHover?.(null);
      });

      if (isActive) {
        marker.bringToFront();
      }

      marker.addTo(layerGroup);
    });
  }, [hoveredListingId, listings, map, onListingHover, onListingSelect, onZoneHover, selectedListingId, zoneStyles]);

  useEffect(() => {
    return () => {
      if (layerRef.current) {
        layerRef.current.removeFrom(map);
        layerRef.current = null;
      }
    };
  }, [map]);

  return null;
}



type ZoningDistrictHighlightsProps = {
  listings: ListingRecord[];
  zoneSummaries: ZoningDistrictSummary[];
  onZoneHover?: (zone: ZoningDistrictSummary | null) => void;
};

type ZoneBlurLayer = {
  summary: ZoningDistrictSummary;
  group: L.FeatureGroup<L.CircleMarker>;
  markers: L.CircleMarker[];
};

function ZoningDistrictHighlights({ listings, zoneSummaries, onZoneHover }: ZoningDistrictHighlightsProps): null {
  const map = useMap();
  const glowGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (IS_TEST_ENV) {
      onZoneHover?.(null);
      return () => {
        onZoneHover?.(null);
      };
    }

    let glowPane = map.getPane('zoneGlowPane');
    if (!glowPane) {
      glowPane = map.createPane('zoneGlowPane');
      glowPane.style.zIndex = '540';
    }
    glowPane.classList.add('region-map__zone-glow-pane');
    glowPane.style.pointerEvents = 'auto';

    if (!glowGroupRef.current) {
      try {
        glowGroupRef.current = L.layerGroup().addTo(map);
      } catch (error) {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console -- surface issues when Leaflet cannot initialise in tests or unsupported envs
          console.warn('Unable to initialise zoning highlight layers.', error);
        }
        onZoneHover?.(null);
        return () => {
          onZoneHover?.(null);
        };
      }
    }

    const glowGroup = glowGroupRef.current;

    if (!glowGroup) {
      return () => {
        onZoneHover?.(null);
      };
    }

    glowGroup.clearLayers();

    if (!zoneSummaries.length) {
      onZoneHover?.(null);
      return () => {
        onZoneHover?.(null);
      };
    }

    const zoneLookup = new Map(zoneSummaries.map((summary) => [summary.key, summary]));
    const zoneLayers = new Map<string, ZoneBlurLayer>();

    listings.forEach((listing) => {
      if (listing.latitude === null || listing.longitude === null) {
        return;
      }

      const zoneKey = normaliseZoneKey(listing.zone);
      if (!zoneKey) {
        return;
      }

      const summary = zoneLookup.get(zoneKey);
      if (!summary) {
        return;
      }

      let zoneLayer = zoneLayers.get(zoneKey);
      if (!zoneLayer) {
        zoneLayer = {
          summary,
          group: L.featureGroup<L.CircleMarker>().addTo(glowGroup),
          markers: [],
        };
        zoneLayers.set(zoneKey, zoneLayer);
      }

      const blurMarker = L.circleMarker([listing.latitude, listing.longitude], {
        pane: 'zoneGlowPane',
        radius: 18,
        color: summary.glowColor,
        weight: 0,
        fillColor: summary.glowColor,
        fillOpacity: 0.45,
        bubblingMouseEvents: false,
        className: 'region-map__zone-glow-marker',
      });

      blurMarker.addTo(zoneLayer.group);
      zoneLayer.markers.push(blurMarker);
    });

    const subscriptions: Array<{
      key: string;
      handlers: { mouseover: () => void; mouseout: () => void };
      cancel: () => void;
    }> = [];

    zoneLayers.forEach((layer, key) => {
      const { summary, markers, group } = layer;
      if (!markers.length) {
        return;
      }

      const applyState = (hovered: boolean) => {
        markers.forEach((marker) => {
          marker.setStyle({
            color: hovered ? summary.glowHoverColor : summary.glowColor,
            fillColor: hovered ? summary.glowHoverColor : summary.glowColor,
            fillOpacity: hovered ? 0.7 : 0.45,
          });
          marker.setRadius(hovered ? 24 : 18);
          if (hovered) {
            marker.bringToFront();
          }
        });
      };

      applyState(false);

      let hoverTimeout: ReturnType<typeof setTimeout> | null = null;

      const handleMouseOver = () => {
        if (hoverTimeout) {
          clearTimeout(hoverTimeout);
          hoverTimeout = null;
        }
        applyState(true);
        onZoneHover?.(summary);
      };

      const handleMouseOut = () => {
        if (hoverTimeout) {
          clearTimeout(hoverTimeout);
        }
        hoverTimeout = setTimeout(() => {
          applyState(false);
          onZoneHover?.(null);
        }, 30);
      };

      group.on('mouseover', handleMouseOver);
      group.on('mouseout', handleMouseOut);

      subscriptions.push({
        key,
        handlers: {
          mouseover: handleMouseOver,
          mouseout: handleMouseOut,
        },
        cancel: () => {
          if (hoverTimeout) {
            clearTimeout(hoverTimeout);
            hoverTimeout = null;
          }
        },
      });
    });

    return () => {
      subscriptions.forEach(({ key, handlers, cancel }) => {
        const layer = zoneLayers.get(key);
        if (layer) {
          layer.group.off('mouseover', handlers.mouseover);
          layer.group.off('mouseout', handlers.mouseout);
        }
        cancel();
      });
      onZoneHover?.(null);
    };
  }, [listings, map, onZoneHover, zoneSummaries]);

  useEffect(() => {
    return () => {
      if (glowGroupRef.current) {
        glowGroupRef.current.removeFrom(map);
        glowGroupRef.current = null;
      }
    };
  }, [map]);

  return null;
}

function RegionMap({
  regions,
  onRegionsChange,
  listings = [],
  allListings = [],
  onListingSelect,
  totalListingCount = 0,
}: RegionMapProps): JSX.Element {
  const mapCenter = useMemo(() => DEFAULT_CENTER, []);
  const subtitle = 'Use the toolbar to draw polygons or circles and focus on specific areas.';
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null);
  const [hoveredListingId, setHoveredListingId] = useState<string | null>(null);
  const [showAllProperties, setShowAllProperties] = useState(false);
  const [currentLayer, setCurrentLayer] = useState<MapLayerType>('map');
  const [zoneMetrics, setZoneMetrics] = useState<ZoneMetric[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!supabase) {
      setZoneMetrics(null);
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const metrics = await fetchZoneMetrics();
        if (!cancelled) {
          setZoneMetrics(metrics);
        }
      } catch (error) {
        console.warn('Failed to load zoning hotspots for the region map.', error);
        if (!cancelled) {
          setZoneMetrics([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const zoningDistrictSummaries = useMemo(() => {
    const metricSummaries = zoneMetrics && zoneMetrics.length > 0
      ? computeTopZoningDistrictsFromMetrics(zoneMetrics)
      : [];

    if (metricSummaries.length > 0) {
      return metricSummaries;
    }

    return computeTopZoningDistrictsFromListings(allListings);
  }, [allListings, zoneMetrics]);
  const zoneStyleLookup = useMemo(() => {
    const lookup = new Map<string, ZoningDistrictSummary>();
    zoningDistrictSummaries.forEach((summary) => {
      lookup.set(summary.key, summary);
    });
    return lookup;
  }, [zoningDistrictSummaries]);
  const [hoveredZone, setHoveredZone] = useState<ZoningDistrictSummary | null>(null);

  const displayedListings = useMemo(() => {
    // When toggle is on, always show all filtered listings
    // When toggle is off, show region-filtered listings only
    return showAllProperties ? allListings : listings;
  }, [showAllProperties, allListings, listings]);

  useEffect(() => {
    if (hoveredZone && !zoneStyleLookup.has(hoveredZone.key)) {
      setHoveredZone(null);
    }
  }, [hoveredZone, zoneStyleLookup]);

  useEffect(() => {
    if (!hoveredZone) {
      return;
    }

    const zoneHasListings = displayedListings.some(
      (listing) => normaliseZoneKey(listing.zone) === hoveredZone.key && listing.latitude !== null && listing.longitude !== null,
    );

    if (!zoneHasListings) {
      setHoveredZone(null);
    }
  }, [displayedListings, hoveredZone]);

  useEffect(() => {
    if (selectedListingId && !displayedListings.some((listing) => listing.id === selectedListingId)) {
      setSelectedListingId(null);
    }
  }, [displayedListings, selectedListingId]);

  useEffect(() => {
    if (hoveredListingId && !displayedListings.some((listing) => listing.id === hoveredListingId)) {
      setHoveredListingId(null);
    }
  }, [hoveredListingId, displayedListings]);

  useEffect(() => {
    if (!selectedListingId && displayedListings.length === 1) {
      setSelectedListingId(displayedListings[0]?.id ?? null);
    }
  }, [displayedListings, selectedListingId]);

  const activeListingId = hoveredListingId ?? (hoveredZone ? null : selectedListingId);

  const activeListing = useMemo(() => {
    if (!activeListingId) {
      return null;
    }
    return displayedListings.find((listing) => listing.id === activeListingId) ?? null;
  }, [activeListingId, displayedListings]);

  const handleMarkerSelect = useCallback(
    (listingId: string) => {
      setHoveredZone(null);
      setSelectedListingId(listingId);
      onListingSelect?.(listingId);
    },
    [onListingSelect],
  );

  const handleMarkerHover = useCallback((listingId: string | null) => {
    if (listingId) {
      setHoveredZone(null);
    }
    setHoveredListingId(listingId);
  }, []);

  const handleToggleShowAll = useCallback(() => {
    setShowAllProperties((prev) => !prev);
  }, []);

  const handleLayerChange = useCallback((layer: MapLayerType) => {
    setCurrentLayer(layer);
  }, []);

  const handleZoneHover = useCallback((zone: ZoningDistrictSummary | null) => {
    if (zone) {
      setHoveredListingId(null);
    }
    setHoveredZone(zone);
  }, []);

  const zoneDetailHighlight = hoveredZone && !hoveredListingId ? hoveredZone : null;

  const currentLayerConfig = MAP_LAYERS[currentLayer];

  return (
    <section
      className="region-map"
      aria-label="Draw regions to filter listings"
      title="Draw polygons or circles to focus the ArcGIS search on specific areas"
    >
      <div>
        <h2 className="region-map__title">Search Regions</h2>
        <p className="region-map__subtitle">
          {subtitle}
        </p>
      </div>
      <div className="region-map__selection-wrapper">
        <ListingSelectionPanel
          listing={activeListing}
          zoneHighlight={zoneDetailHighlight}
          hasListings={displayedListings.length > 0}
          totalListingCount={totalListingCount}
        />
      </div>
      <MapContainer
        className="region-map__map"
        center={mapCenter}
        zoom={DEFAULT_ZOOM}
        scrollWheelZoom
      >
        <TileLayer 
          url={currentLayerConfig.url} 
          attribution={currentLayerConfig.attribution}
          maxZoom={currentLayerConfig.maxZoom}
        />
        <SummitCountyOverlay />
        <DrawManager
          regions={regions}
          onRegionsChange={onRegionsChange}
          showAllProperties={showAllProperties}
          onToggleShowAll={handleToggleShowAll}
          currentLayer={currentLayer}
          onLayerChange={handleLayerChange}
        />
        {displayedListings.length ? (
          <ListingMarkers
            listings={displayedListings}
            zoneStyles={zoneStyleLookup}
            onListingSelect={handleMarkerSelect}
            selectedListingId={selectedListingId}
            hoveredListingId={hoveredListingId}
            onListingHover={handleMarkerHover}
            onZoneHover={handleZoneHover}
          />
        ) : null}
        <ZoningDistrictHighlights
          listings={displayedListings}
          zoneSummaries={zoningDistrictSummaries}
          onZoneHover={handleZoneHover}
        />
      </MapContainer>
    </section>
  );
}

export default RegionMap;
export { MAP_LAYERS, LAYER_ORDER, getNextLayer };
export type { MapLayerType, MapLayerConfig };
