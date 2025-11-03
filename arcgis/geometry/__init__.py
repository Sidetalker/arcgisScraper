"""Geometry helpers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict


@dataclass
class Geometry:
    """Wrapper that mirrors the ArcGIS geometry API we depend on."""

    _data: Dict[str, Any]

    def to_dict(self) -> Dict[str, Any]:  # pragma: no cover - simple passthrough
        return dict(self._data)
