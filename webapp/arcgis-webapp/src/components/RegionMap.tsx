import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';

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

import './RegionMap.css';

type RegionMapProps = {
  regions: RegionShape[];
  onRegionsChange: (regions: RegionShape[]) => void;
  listings?: ListingRecord[];
  onListingSelect?: (listingId: string) => void;
  totalListingCount?: number;
};

const DEFAULT_CENTER: [number, number] = [39.6, -106.07];
const DEFAULT_ZOOM = 10;

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
};

function ListingSelectionPanel({ listing, hasListings, totalListingCount }: ListingSelectionPanelProps): JSX.Element {
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
};

type MapToolbarProps = {
  onDrawPolygon: () => void;
  onDrawCircle: () => void;
  onClearRegions: () => void;
  onFitRegions: () => void;
  hasRegions: boolean;
  activeTool: 'polygon' | 'circle' | null;
};

function MapToolbar({
  onDrawPolygon,
  onDrawCircle,
  onClearRegions,
  onFitRegions,
  hasRegions,
  activeTool,
}: MapToolbarProps): null {
  const map = useMap();
  const buttonRefs = useRef<
    | {
        clearButton?: HTMLButtonElement;
        fitButton?: HTMLButtonElement;
        polygonButton?: HTMLButtonElement;
        circleButton?: HTMLButtonElement;
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

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      [clearButton, fitButton].forEach((button) => {
        button.disabled = true;
        button.setAttribute('aria-disabled', 'true');
        button.classList.add('region-map__toolbar-button--disabled');
      });

      buttonRefs.current = { clearButton, fitButton, polygonButton, circleButton };

      return container;
    };

    toolbarControl.addTo(map);

    return () => {
      buttonRefs.current = null;
      toolbarControl.remove();
    };
  }, [map, onClearRegions, onDrawCircle, onDrawPolygon, onFitRegions]);

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
    />
  );
}

type ListingMarkersProps = {
  listings: ListingRecord[];
  onListingSelect?: (listingId: string) => void;
  selectedListingId?: string | null;
  hoveredListingId?: string | null;
  onListingHover?: (listingId: string | null) => void;
};

function ListingMarkers({ listings, onListingSelect, selectedListingId, hoveredListingId, onListingHover }: ListingMarkersProps): null {
  const map = useMap();
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
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

      const marker = L.circleMarker([listing.latitude, listing.longitude], {
        radius: isActive ? 7 : 5,
        color: isActive ? '#1d4ed8' : '#991b1b',
        weight: isActive ? 2 : 1,
        fillColor: isActive ? '#3b82f6' : '#ef4444',
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
  }, [hoveredListingId, listings, map, onListingHover, onListingSelect, selectedListingId]);

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

function RegionMap({
  regions,
  onRegionsChange,
  listings = [],
  onListingSelect,
  totalListingCount = 0,
}: RegionMapProps): JSX.Element {
  const mapCenter = useMemo(() => DEFAULT_CENTER, []);
  const subtitle = 'Use the toolbar to draw polygons or circles and focus on specific areas.';
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null);
  const [hoveredListingId, setHoveredListingId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedListingId && !listings.some((listing) => listing.id === selectedListingId)) {
      setSelectedListingId(null);
    }
  }, [listings, selectedListingId]);

  useEffect(() => {
    if (hoveredListingId && !listings.some((listing) => listing.id === hoveredListingId)) {
      setHoveredListingId(null);
    }
  }, [hoveredListingId, listings]);

  useEffect(() => {
    if (!selectedListingId && listings.length === 1) {
      setSelectedListingId(listings[0]?.id ?? null);
    }
  }, [listings, selectedListingId]);

  const activeListingId = hoveredListingId ?? selectedListingId;

  const activeListing = useMemo(() => {
    if (!activeListingId) {
      return null;
    }
    return listings.find((listing) => listing.id === activeListingId) ?? null;
  }, [activeListingId, listings]);

  const handleMarkerSelect = useCallback(
    (listingId: string) => {
      setSelectedListingId(listingId);
      onListingSelect?.(listingId);
    },
    [onListingSelect],
  );

  const handleMarkerHover = useCallback((listingId: string | null) => {
    setHoveredListingId(listingId);
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
          hasListings={listings.length > 0}
          totalListingCount={totalListingCount}
        />
      </div>
      <MapContainer
        className="region-map__map"
        center={mapCenter}
        zoom={DEFAULT_ZOOM}
        scrollWheelZoom
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
        <DrawManager
          regions={regions}
          onRegionsChange={onRegionsChange}
        />
        {listings.length ? (
          <ListingMarkers
            listings={listings}
            onListingSelect={handleMarkerSelect}
            selectedListingId={selectedListingId}
            hoveredListingId={hoveredListingId}
            onListingHover={handleMarkerHover}
          />
        ) : null}
      </MapContainer>
    </section>
  );
}

export default RegionMap;
