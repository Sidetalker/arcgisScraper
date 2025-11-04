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

  if (!overlayGeometry) {
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
  hasListings: boolean;
  totalListingCount: number;
  hoveredDistrict?: string | null;
  zoningDistricts?: ZoningDistrictMap;
};

function ListingSelectionPanel({ 
  listing, 
  hasListings, 
  totalListingCount,
  hoveredDistrict,
  zoningDistricts,
}: ListingSelectionPanelProps): JSX.Element {
  // If hovering over a district, show district info
  if (hoveredDistrict && zoningDistricts) {
    const districtInfo = zoningDistricts.get(hoveredDistrict);
    if (districtInfo) {
      return (
        <div className="region-map__selection" aria-live="polite">
          <div className="region-map__selection-header">
            <div className="region-map__selection-heading">
              <h3 className="region-map__selection-title">Zoning District: {districtInfo.name}</h3>
            </div>
          </div>
          <dl className="region-map__selection-grid">
            <div>
              <dt>Properties in District</dt>
              <dd>{districtInfo.count.toLocaleString()}</dd>
            </div>
            <div>
              <dt>District Color</dt>
              <dd>
                <span style={{ 
                  display: 'inline-block', 
                  width: '20px', 
                  height: '20px', 
                  backgroundColor: districtInfo.color,
                  borderRadius: '4px',
                  verticalAlign: 'middle',
                  marginRight: '8px',
                  border: '1px solid #cbd5e1',
                }} />
                {districtInfo.color}
              </dd>
            </div>
          </dl>
        </div>
      );
    }
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
        <p className="region-map__selection-empty-secondary">
          {countMessage}
        </p>
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
}: MapToolbarProps): null {
  const map = useMap();
  const buttonRefs = useRef<
    | {
        clearButton?: HTMLButtonElement;
        fitButton?: HTMLButtonElement;
        polygonButton?: HTMLButtonElement;
        circleButton?: HTMLButtonElement;
        toggleAllButton?: HTMLButtonElement;
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
      toggleAllButton.setAttribute('aria-pressed', showAllProperties ? 'true' : 'false');
      if (showAllProperties) {
        toggleAllButton.classList.add('region-map__toolbar-button--active');
      }
      toggleAllButton.addEventListener('click', (event) => {
        event.preventDefault();
        onToggleShowAll();
      });

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      [clearButton, fitButton].forEach((button) => {
        button.disabled = true;
        button.setAttribute('aria-disabled', 'true');
        button.classList.add('region-map__toolbar-button--disabled');
      });

      buttonRefs.current = { clearButton, fitButton, polygonButton, circleButton, toggleAllButton };

      return container;
    };

    toolbarControl.addTo(map);

    return () => {
      buttonRefs.current = null;
      toolbarControl.remove();
    };
  }, [map, onClearRegions, onDrawCircle, onDrawPolygon, onFitRegions, onToggleShowAll, showAllProperties]);

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

  return null;
}

function DrawManager({
  regions,
  onRegionsChange,
  showAllProperties,
  onToggleShowAll,
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
    />
  );
}

type ZoningDistrictInfo = {
  name: string;
  count: number;
  color: string;
};

type ZoningDistrictMap = Map<string, ZoningDistrictInfo>;

const DISTRICT_COLORS = [
  '#e74c3c', // Red
  '#3498db', // Blue
  '#2ecc71', // Green
  '#f39c12', // Orange
  '#9b59b6', // Purple
  '#1abc9c', // Turquoise
  '#e67e22', // Carrot
  '#34495e', // Dark Blue Gray
  '#16a085', // Green Sea
  '#c0392b', // Dark Red
];

const DEFAULT_MARKER_COLOR = '#3b82f6'; // Blue fallback

function computeTopZoningDistricts(listings: ListingRecord[]): ZoningDistrictMap {
  const districtCounts = new Map<string, number>();
  
  // Count properties per district
  listings.forEach((listing) => {
    if (listing.zoningDistrict) {
      const count = districtCounts.get(listing.zoningDistrict) || 0;
      districtCounts.set(listing.zoningDistrict, count + 1);
    }
  });

  // Filter districts with > 100 properties and get top 10
  const qualifiedDistricts = Array.from(districtCounts.entries())
    .filter(([, count]) => count > 100)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Create map with assigned colors
  const districtMap = new Map<string, ZoningDistrictInfo>();
  qualifiedDistricts.forEach(([name, count], index) => {
    districtMap.set(name, {
      name,
      count,
      color: DISTRICT_COLORS[index] || DISTRICT_COLORS[0],
    });
  });

  return districtMap;
}

type ListingMarkersProps = {
  listings: ListingRecord[];
  onListingSelect?: (listingId: string) => void;
  selectedListingId?: string | null;
  hoveredListingId?: string | null;
  onListingHover?: (listingId: string | null) => void;
  zoningDistricts: ZoningDistrictMap;
  hoveredDistrict?: string | null;
};

function ListingMarkers({ 
  listings, 
  onListingSelect, 
  selectedListingId, 
  hoveredListingId, 
  onListingHover,
  zoningDistricts,
  hoveredDistrict,
}: ListingMarkersProps): null {
  const map = useMap();
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const blurLayerRef = useRef<L.LayerGroup | null>(null);

  // Render blur effects for zoning districts
  useEffect(() => {
    if (!blurLayerRef.current) {
      // Create blur layer below markers
      blurLayerRef.current = L.layerGroup().addTo(map);
      blurLayerRef.current.getPane()!.style.zIndex = '400'; // Below markerPane (600)
    }
    
    const blurGroup = blurLayerRef.current;
    blurGroup.clearLayers();

    if (zoningDistricts.size === 0) {
      return;
    }

    // Group listings by district
    const listingsByDistrict = new Map<string, ListingRecord[]>();
    listings.forEach((listing) => {
      if (listing.latitude !== null && listing.longitude !== null && listing.zoningDistrict) {
        const districtInfo = zoningDistricts.get(listing.zoningDistrict);
        if (districtInfo) {
          if (!listingsByDistrict.has(listing.zoningDistrict)) {
            listingsByDistrict.set(listing.zoningDistrict, []);
          }
          listingsByDistrict.get(listing.zoningDistrict)!.push(listing);
        }
      }
    });

    // Create blur circles for each district
    listingsByDistrict.forEach((districtListings, districtName) => {
      const districtInfo = zoningDistricts.get(districtName)!;
      const isHovered = hoveredDistrict === districtName;
      
      districtListings.forEach((listing) => {
        if (listing.latitude === null || listing.longitude === null) {
          return;
        }

        // Create blur effect with larger radius
        const blurRadius = isHovered ? 35 : 30;
        const blurOpacity = isHovered ? 0.35 : 0.25;
        const blurColor = isHovered ? adjustColorBrightness(districtInfo.color, -20) : districtInfo.color;

        const blurCircle = L.circle([listing.latitude, listing.longitude], {
          radius: blurRadius,
          color: blurColor,
          weight: 0,
          fillColor: blurColor,
          fillOpacity: blurOpacity,
          className: 'district-blur',
        });

        blurCircle.addTo(blurGroup);
      });
    });
  }, [hoveredDistrict, listings, map, zoningDistricts]);

  // Render property markers
  useEffect(() => {
    if (!markersLayerRef.current) {
      markersLayerRef.current = L.layerGroup().addTo(map);
    }
    const layerGroup = markersLayerRef.current;
    layerGroup.clearLayers();

    listings.forEach((listing) => {
      if (listing.latitude === null || listing.longitude === null) {
        return;
      }

      const isSelected = listing.id === selectedListingId;
      const isHovered = listing.id === hoveredListingId;
      const isActive = isSelected || isHovered;

      // Determine marker color based on zoning district
      let markerColor = DEFAULT_MARKER_COLOR;
      let markerBorderColor = '#1d4ed8';
      
      if (listing.zoningDistrict) {
        const districtInfo = zoningDistricts.get(listing.zoningDistrict);
        if (districtInfo) {
          markerColor = districtInfo.color;
          markerBorderColor = adjustColorBrightness(districtInfo.color, -30);
        }
      }

      const marker = L.circleMarker([listing.latitude, listing.longitude], {
        radius: isActive ? 7 : 5,
        color: isActive ? markerBorderColor : markerBorderColor,
        weight: isActive ? 2 : 1,
        fillColor: isActive ? markerColor : markerColor,
        fillOpacity: isActive ? 0.95 : 0.85,
        pane: 'markerPane',
      });

      marker.on('click', (event: L.LeafletMouseEvent) => {
        event.originalEvent?.preventDefault?.();
        event.originalEvent?.stopPropagation?.();
        onListingSelect?.(listing.id);
      });

      marker.on('mouseover', () => {
        onListingHover?.(listing.id);
      });

      if (isActive) {
        marker.bringToFront();
      }

      marker.addTo(layerGroup);
    });
  }, [hoveredListingId, listings, map, onListingHover, onListingSelect, selectedListingId, zoningDistricts]);

  useEffect(() => {
    return () => {
      if (markersLayerRef.current) {
        markersLayerRef.current.removeFrom(map);
        markersLayerRef.current = null;
      }
      if (blurLayerRef.current) {
        blurLayerRef.current.removeFrom(map);
        blurLayerRef.current = null;
      }
    };
  }, [map]);

  return null;
}

// Helper function to adjust color brightness
function adjustColorBrightness(color: string, percent: number): string {
  const hex = color.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  const adjust = (value: number) => {
    const adjusted = value + (value * percent) / 100;
    return Math.max(0, Math.min(255, Math.round(adjusted)));
  };

  const newR = adjust(r).toString(16).padStart(2, '0');
  const newG = adjust(g).toString(16).padStart(2, '0');
  const newB = adjust(b).toString(16).padStart(2, '0');

  return `#${newR}${newG}${newB}`;
}

type DistrictHoverZonesProps = {
  listings: ListingRecord[];
  zoningDistricts: ZoningDistrictMap;
  onDistrictHover?: (districtName: string | null) => void;
};

function DistrictHoverZones({ 
  listings, 
  zoningDistricts,
  onDistrictHover,
}: DistrictHoverZonesProps): null {
  const map = useMap();
  const zonesLayerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!zonesLayerRef.current) {
      zonesLayerRef.current = L.layerGroup().addTo(map);
      zonesLayerRef.current.getPane()!.style.zIndex = '450'; // Between blur and markers
    }
    
    const zonesGroup = zonesLayerRef.current;
    zonesGroup.clearLayers();

    if (zoningDistricts.size === 0) {
      return;
    }

    // Group listings by district
    const listingsByDistrict = new Map<string, ListingRecord[]>();
    listings.forEach((listing) => {
      if (listing.latitude !== null && listing.longitude !== null && listing.zoningDistrict) {
        const districtInfo = zoningDistricts.get(listing.zoningDistrict);
        if (districtInfo) {
          if (!listingsByDistrict.has(listing.zoningDistrict)) {
            listingsByDistrict.set(listing.zoningDistrict, []);
          }
          listingsByDistrict.get(listing.zoningDistrict)!.push(listing);
        }
      }
    });

    // Create invisible hover zones for each district property
    listingsByDistrict.forEach((districtListings, districtName) => {
      districtListings.forEach((listing) => {
        if (listing.latitude === null || listing.longitude === null) {
          return;
        }

        // Create invisible hover zone
        const hoverZone = L.circle([listing.latitude, listing.longitude], {
          radius: 30, // Match blur radius
          color: 'transparent',
          weight: 0,
          fillColor: 'transparent',
          fillOpacity: 0,
          interactive: true,
        });

        hoverZone.on('mouseover', (event: L.LeafletMouseEvent) => {
          // Check if mouse is actually over the marker (within 20px)
          const marker = event.target as L.Circle;
          const markerLatLng = marker.getLatLng();
          const mousePoint = map.latLngToContainerPoint(event.latlng);
          const markerPoint = map.latLngToContainerPoint(markerLatLng);
          
          const distance = Math.sqrt(
            Math.pow(mousePoint.x - markerPoint.x, 2) + 
            Math.pow(mousePoint.y - markerPoint.y, 2)
          );

          // If within 20px (marker hitbox), don't trigger district hover
          if (distance <= 20) {
            return;
          }

          onDistrictHover?.(districtName);
        });

        hoverZone.on('mouseout', () => {
          onDistrictHover?.(null);
        });

        hoverZone.addTo(zonesGroup);
      });
    });
  }, [listings, map, onDistrictHover, zoningDistricts]);

  useEffect(() => {
    return () => {
      if (zonesLayerRef.current) {
        zonesLayerRef.current.removeFrom(map);
        zonesLayerRef.current = null;
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
  const [hoveredDistrict, setHoveredDistrict] = useState<string | null>(null);
  const [showAllProperties, setShowAllProperties] = useState(false);

  const displayedListings = useMemo(() => {
    // When toggle is on and regions exist, show all filtered listings
    // Otherwise show region-filtered listings (or all if no regions)
    return showAllProperties && regions.length > 0 ? allListings : listings;
  }, [showAllProperties, regions.length, allListings, listings]);

  // Compute top zoning districts from all listings (not just displayed)
  const zoningDistricts = useMemo(() => {
    return computeTopZoningDistricts(allListings.length > 0 ? allListings : listings);
  }, [allListings, listings]);

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

  const activeListingId = hoveredListingId ?? selectedListingId;

  const activeListing = useMemo(() => {
    if (!activeListingId) {
      return null;
    }
    return displayedListings.find((listing) => listing.id === activeListingId) ?? null;
  }, [activeListingId, displayedListings]);

  const handleMarkerSelect = useCallback(
    (listingId: string) => {
      setSelectedListingId(listingId);
      onListingSelect?.(listingId);
    },
    [onListingSelect],
  );

  const handleMarkerHover = useCallback((listingId: string | null) => {
    setHoveredListingId(listingId);
    // Clear district hover when hovering a property
    if (listingId) {
      setHoveredDistrict(null);
    }
  }, []);

  const handleDistrictHover = useCallback((districtName: string | null) => {
    setHoveredDistrict(districtName);
    // Clear property hover when hovering a district
    if (districtName) {
      setHoveredListingId(null);
    }
  }, []);

  const handleToggleShowAll = useCallback(() => {
    setShowAllProperties((prev) => !prev);
  }, []);

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
          hasListings={displayedListings.length > 0}
          totalListingCount={totalListingCount}
          hoveredDistrict={hoveredDistrict}
          zoningDistricts={zoningDistricts}
        />
      </div>
      <MapContainer
        className="region-map__map"
        center={mapCenter}
        zoom={DEFAULT_ZOOM}
        scrollWheelZoom
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
        <SummitCountyOverlay />
        <DrawManager
          regions={regions}
          onRegionsChange={onRegionsChange}
          showAllProperties={showAllProperties}
          onToggleShowAll={handleToggleShowAll}
        />
        {displayedListings.length ? (
          <>
            <DistrictHoverZones
              listings={displayedListings}
              zoningDistricts={zoningDistricts}
              onDistrictHover={handleDistrictHover}
            />
            <ListingMarkers
              listings={displayedListings}
              onListingSelect={handleMarkerSelect}
              selectedListingId={selectedListingId}
              hoveredListingId={hoveredListingId}
              onListingHover={handleMarkerHover}
              zoningDistricts={zoningDistricts}
              hoveredDistrict={hoveredDistrict}
            />
          </>
        ) : null}
      </MapContainer>
    </section>
  );
}

export default RegionMap;
