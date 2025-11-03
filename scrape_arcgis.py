"""CLI for exploring Summit County, CO short-term rental data via ArcGIS."""

from __future__ import annotations

import argparse
import getpass
import json
import math
import os
import sys
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from arcgis.features import FeatureLayer
from arcgis.gis import GIS
from arcgis.geometry import Geometry
from arcgis.geometry.filters import intersects


# The hosted feature layer that powers the Summit County, CO Short-Term Rental
# public map. The layer exposes individual rental properties keyed by their
# Summit County schedule number (``Schno``) alongside permit metadata.
DEFAULT_LAYER_URL = (
    "https://gis.summitcountyco.gov/server/rest/services/Hosted/"
    "Short_Term_Rental_Public/FeatureServer/0"
)

# Connecting to the county's ArcGIS Online organization makes it easy to reuse
# the same authenticated session if the user also needs to access other hosted
# content.
DEFAULT_PORTAL_URL = "https://summitcountyco.maps.arcgis.com"

# Summit County's feature services expect cross-domain requests to include a
# Referer header that matches the county's GIS hostname. Allow callers to
# override the header, but default to the county host so that queries work out
# of the box.
DEFAULT_REFERER = "https://gis.summitcountyco.gov"


@dataclass
class QueryResult:
    """Container for aggregating paginated query responses."""

    template: Dict[str, Any]
    features: List[Dict[str, Any]]

    def to_dict(self) -> Dict[str, Any]:
        payload = dict(self.template)
        payload["features"] = list(self.features)
        payload.setdefault("exceededTransferLimit", False)
        return payload


def create_gis(
    portal_url: str,
    username: Optional[str],
    password: Optional[str],
    api_key: Optional[str],
    referer: Optional[str],
) -> GIS:
    """Authenticate against an ArcGIS portal."""

    if api_key:
        return GIS(portal_url, api_key=api_key, referer=referer)

    if username:
        if password is None:
            if sys.stdin.isatty():
                password = getpass.getpass(f"Password for {username}: ")
            else:  # pragma: no cover - non-interactive fallback
                raise RuntimeError("Password is required when providing --username")
        return GIS(portal_url, username, password, referer=referer)

    return GIS(portal_url, anonymous=True, referer=referer)


def resolve_layer(gis: GIS, layer_url: Optional[str], item_id: Optional[str], layer_index: int) -> FeatureLayer:
    """Return the ArcGIS feature layer that should be queried."""

    if layer_url:
        return FeatureLayer(layer_url, gis=gis)

    if item_id:
        item = gis.content.get(item_id)
        if item is None:
            raise RuntimeError(f"Unable to find ArcGIS item with id '{item_id}'")

        try:
            return item.layers[layer_index]
        except (IndexError, AttributeError) as exc:  # pragma: no cover - defensive path
            raise RuntimeError(
                f"Item '{item_id}' does not expose a layer at index {layer_index}."
            ) from exc

    raise RuntimeError("Either --layer-url or --item-id must be provided")


def build_search_geometry(lat: float, lng: float, radius_m: float) -> Geometry:
    """Construct a WGS84 envelope around the requested coordinate."""

    meters_per_degree_lat = 111_320.0
    meters_per_degree_lng = meters_per_degree_lat * math.cos(math.radians(lat))

    if meters_per_degree_lng == 0:  # pragma: no cover - invalid latitude guard
        raise ValueError("Unable to compute longitude delta for the provided latitude")

    delta_lat = radius_m / meters_per_degree_lat
    delta_lng = radius_m / meters_per_degree_lng

    envelope = {
        "xmin": lng - delta_lng,
        "xmax": lng + delta_lng,
        "ymin": lat - delta_lat,
        "ymax": lat + delta_lat,
        "spatialReference": {"wkid": 4326},
    }
    return Geometry(envelope)


def _initial_page_size(layer: FeatureLayer, max_records: Optional[int]) -> int:
    default_size = getattr(getattr(layer, "properties", None), "maxRecordCount", 1000) or 1000
    if max_records is not None:
        return min(default_size, max_records)
    return default_size


def query_features(
    layer: FeatureLayer,
    geometry: Geometry,
    where: str,
    out_fields: str,
    return_geometry: bool,
    max_records: Optional[int],
) -> QueryResult:
    """Query the feature layer and page through the full response."""

    page_size = _initial_page_size(layer, max_records)
    offset = 0
    collected: List[Dict[str, Any]] = []
    template: Optional[Dict[str, Any]] = None

    while True:
        feature_set = layer.query(
            where=where,
            out_fields=out_fields,
            geometry_filter=intersects(geometry),
            return_geometry=return_geometry,
            out_sr=4326,
            result_offset=offset,
            result_record_count=page_size,
        )
        page = feature_set.to_dict()

        if template is None:
            template = {k: v for k, v in page.items() if k != "features"}

        features = page.get("features", [])
        collected.extend(features)

        if max_records is not None and len(collected) >= max_records:
            collected = collected[:max_records]
            template["exceededTransferLimit"] = len(features) == page_size
            break

        if not features or len(features) < page_size:
            template["exceededTransferLimit"] = page.get("exceededTransferLimit", False)
            break

        offset += page_size

    assert template is not None  # pragma: no cover - template is set on first iteration
    return QueryResult(template=template, features=collected)


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Query a Summit County, CO short-term rental feature layer using the "
            "ArcGIS Python API and dump the raw JSON response for inspection."
        )
    )
    parser.add_argument("lat", type=float, help="Latitude in decimal degrees")
    parser.add_argument("lng", type=float, help="Longitude in decimal degrees")
    parser.add_argument(
        "-r",
        "--radius",
        type=float,
        default=250.0,
        help="Search radius in meters (default: 250)",
    )
    parser.add_argument(
        "--portal-url",
        default=DEFAULT_PORTAL_URL,
        help="ArcGIS portal URL to authenticate against (default: %(default)s)",
    )
    parser.add_argument(
        "--referer",
        default=os.getenv("ARCGIS_REFERER", DEFAULT_REFERER),
        help=(
            "Referer header to send with ArcGIS requests. Defaults to the Summit "
            "County GIS host so cross-domain queries succeed. Override when "
            "targeting other services."
        ),
    )
    parser.add_argument(
        "--api-key",
        default=os.getenv("ARCGIS_API_KEY"),
        help=(
            "ArcGIS API key for authentication (defaults to the ARCGIS_API_KEY "
            "environment variable if set)"
        ),
    )
    parser.add_argument("--username", help="ArcGIS username for authentication")
    parser.add_argument(
        "--password",
        help="Password for the supplied username (prompted if omitted)",
    )
    parser.add_argument(
        "--layer-url",
        default=DEFAULT_LAYER_URL,
        help="Feature layer URL to query (default: Summit County short-term rentals)",
    )
    parser.add_argument(
        "--item-id",
        help="ArcGIS item id containing the desired layer (used when --layer-url is omitted)",
    )
    parser.add_argument(
        "--layer-index",
        type=int,
        default=0,
        help="Layer index within the ArcGIS item (default: 0)",
    )
    parser.add_argument(
        "--where",
        default="1=1",
        help="Optional WHERE clause to further filter results",
    )
    parser.add_argument(
        "--out-fields",
        default="*",
        help="Comma-separated list of fields to return (default: all fields)",
    )
    parser.add_argument(
        "--max-records",
        type=int,
        help="Maximum number of records to return (defaults to service limit)",
    )
    parser.add_argument(
        "--no-geometry",
        dest="return_geometry",
        action="store_false",
        help="Omit geometry from the response payload",
    )
    parser.set_defaults(return_geometry=True)
    parser.add_argument("--output", help="Optional file path to save the JSON payload")
    return parser.parse_args(argv)


def main(argv: List[str]) -> int:
    args = parse_args(argv)

    try:
        gis = create_gis(
            args.portal_url,
            args.username,
            args.password,
            args.api_key,
            args.referer,
        )
        layer = resolve_layer(gis, args.layer_url, args.item_id, args.layer_index)
        geometry = build_search_geometry(args.lat, args.lng, args.radius)
        result = query_features(
            layer=layer,
            geometry=geometry,
            where=args.where,
            out_fields=args.out_fields,
            return_geometry=args.return_geometry,
            max_records=args.max_records,
        )
    except Exception as exc:  # pragma: no cover - CLI surface area
        print(f"Error querying ArcGIS feature layer: {exc}", file=sys.stderr)
        return 1

    payload = result.to_dict()
    formatted = json.dumps(payload, indent=2, sort_keys=True)
    print(formatted)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as handle:
            handle.write(formatted)

    return 0


if __name__ == "__main__":  # pragma: no cover - CLI entrypoint
    raise SystemExit(main(sys.argv[1:]))

