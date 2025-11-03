"""Geometry filter helpers mimicking arcgis.geometry.filters."""

from __future__ import annotations

from typing import Dict

from . import Geometry


def intersects(geometry: Geometry) -> Dict[str, str]:
    geom_dict = geometry.to_dict()
    return {
        "geometry": json_dumps(geom_dict),
        "geometryType": "esriGeometryEnvelope",
        "spatialRel": "esriSpatialRelIntersects",
    }


def json_dumps(data: Dict) -> str:
    try:
        import json

        return json.dumps(data)
    except Exception as exc:  # pragma: no cover - extremely defensive
        raise RuntimeError("Failed to encode geometry filter to JSON") from exc
