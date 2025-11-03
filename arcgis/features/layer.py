"""Minimal FeatureLayer implementation for querying REST services."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict, Optional

from ..gis import GIS


@dataclass
class FeatureSet:
    """Container that mimics the ArcGIS FeatureSet API."""

    _payload: Dict[str, Any]

    def to_dict(self) -> Dict[str, Any]:  # pragma: no cover - simple passthrough
        return dict(self._payload)


class FeatureLayer:
    """Lightweight wrapper around an ArcGIS FeatureServer layer."""

    def __init__(self, url: str, *, gis: GIS) -> None:
        self.url = url.rstrip("/")
        self._gis = gis
        self.properties = self._load_properties()

    def _load_properties(self) -> Dict[str, Any]:
        return self._gis.request(self.url)

    def query(
        self,
        *,
        where: str = "1=1",
        out_fields: str = "*",
        geometry_filter: Optional[Dict[str, Any]] = None,
        return_geometry: bool = True,
        out_sr: Optional[int] = None,
        result_offset: Optional[int] = None,
        result_record_count: Optional[int] = None,
    ) -> FeatureSet:
        params: Dict[str, Any] = {
            "where": where,
            "outFields": out_fields,
            "returnGeometry": json.dumps(bool(return_geometry)),
        }
        if out_sr is not None:
            params["outSR"] = out_sr
        if result_offset is not None:
            params["resultOffset"] = result_offset
        if result_record_count is not None:
            params["resultRecordCount"] = result_record_count
        if geometry_filter:
            params.update(geometry_filter)
        payload = self._gis.request(f"{self.url}/query", method="POST", params=params)
        return FeatureSet(payload)
