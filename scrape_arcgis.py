"""Command-line tool to query ArcGIS feature services around a coordinate.

This script helps explore ArcGIS REST services by sending a `query`
request to a FeatureServer layer. It builds a simple envelope around a
latitude/longitude point and prints the full JSON response so that we
can inspect the available fields before building more targeted scraping
logic.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from typing import Any, Dict

from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

# A public parcel dataset hosted by Esri. You can replace this with any other
# FeatureServer layer that contains the data you are interested in.
DEFAULT_SERVICE_URL = (
    "https://services.arcgis.com/P3ePLMYs2RVChkJx/ArcGIS/rest/services/"
    "Tax_Parcels/FeatureServer/0"
)


def build_envelope(lat: float, lng: float, radius_m: float) -> Dict[str, Any]:
    """Return an ArcGIS envelope geometry around the point.

    ArcGIS expects envelope coordinates in the spatial reference of the query.
    We approximate a square around the point by converting meters to degrees.
    """

    # Rough conversion from meters to degrees latitude/longitude.
    meters_per_degree_lat = 111_320.0
    meters_per_degree_lng = meters_per_degree_lat * math.cos(math.radians(lat))

    if meters_per_degree_lng == 0:
        raise ValueError("Longitude conversion factor is zero; invalid latitude provided.")

    delta_lat = radius_m / meters_per_degree_lat
    delta_lng = radius_m / meters_per_degree_lng

    return {
        "xmin": lng - delta_lng,
        "xmax": lng + delta_lng,
        "ymin": lat - delta_lat,
        "ymax": lat + delta_lat,
        "spatialReference": {"wkid": 4326},
    }


def query_service(
    service_url: str, lat: float, lng: float, radius_m: float, timeout: int = 30
) -> Dict[str, Any]:
    """Query the ArcGIS service and return the parsed JSON response."""

    envelope = build_envelope(lat, lng, radius_m)
    params = {
        "f": "json",
        "geometry": json.dumps(envelope),
        "geometryType": "esriGeometryEnvelope",
        "inSR": 4326,
        "outSR": 4326,
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "*",
        "returnGeometry": "true",
    }

    url = f"{service_url}/query?{urlencode(params)}"
    request = Request(url)

    try:
        with urlopen(request, timeout=timeout) as response:
            payload = json.load(response)
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP error {exc.code} when querying service: {body}") from exc
    except URLError as exc:  # pragma: no cover - network issue
        raise RuntimeError(f"Failed to connect to ArcGIS service: {exc}") from exc

    if "error" in payload:
        message = payload["error"].get("message", "Unknown error")
        details = payload["error"].get("details", [])
        detail_str = "; ".join(details)
        raise RuntimeError(f"ArcGIS error: {message}. Details: {detail_str}")

    return payload


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Query an ArcGIS FeatureServer layer by building a bounding box "
            "around a latitude/longitude and printing the raw JSON response."
        )
    )
    parser.add_argument("lat", type=float, help="Latitude in decimal degrees")
    parser.add_argument("lng", type=float, help="Longitude in decimal degrees")
    parser.add_argument(
        "-r",
        "--radius",
        type=float,
        default=250,
        help="Search radius in meters (default: 250)",
    )
    parser.add_argument(
        "-s",
        "--service-url",
        default=DEFAULT_SERVICE_URL,
        help="ArcGIS FeatureServer layer URL (default: %(default)s)",
    )
    parser.add_argument(
        "-o",
        "--output",
        help="Optional path to save the JSON response",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)

    try:
        response = query_service(args.service_url, args.lat, args.lng, args.radius)
    except Exception as exc:  # pragma: no cover - CLI surface
        print(f"Error querying service: {exc}", file=sys.stderr)
        return 1

    formatted = json.dumps(response, indent=2, sort_keys=True)
    print(formatted)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as fh:
            fh.write(formatted)

    return 0


if __name__ == "__main__":  # pragma: no cover - CLI entrypoint
    raise SystemExit(main(sys.argv[1:]))
