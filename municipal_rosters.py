"""Helpers for downloading Summit County municipal STR license rosters."""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Sequence

from arcgis.features import FeatureLayer
from arcgis.gis import GIS


LOGGER = logging.getLogger(__name__)


def _normalise_schedule_number(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text.upper()


_STATUS_ALIASES = {
    "APPROVED": "active",
    "ACTIVE": "active",
    "ISSUED": "active",
    "CURRENT": "active",
    "GOOD STANDING": "active",
    "IN GOOD STANDING": "active",
    "RENEWED": "active",
    "PAID": "active",
    "PENDING": "pending",
    "UNDER REVIEW": "pending",
    "IN PROCESS": "pending",
    "EXPIRED": "expired",
    "INACTIVE": "inactive",
    "SUSPENDED": "inactive",
    "REVOKED": "revoked",
    "DENIED": "revoked",
    "CANCELLED": "revoked",
    "CANCELED": "revoked",
}


def _normalise_status(value: Any) -> str:
    if value is None:
        return "unknown"
    text = str(value).strip()
    if not text:
        return "unknown"
    upper = text.upper()
    for key, alias in _STATUS_ALIASES.items():
        if key in upper:
            return alias
    return "unknown"


def _parse_date(value: Any) -> Optional[str]:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, (int, float)):
        if value > 1e12:
            try:
                return datetime.utcfromtimestamp(value / 1000).date().isoformat()
            except (OverflowError, ValueError):
                return None
        if value > 1e9:
            try:
                return datetime.utcfromtimestamp(value).date().isoformat()
            except (OverflowError, ValueError):
                return None
    try:
        parsed = datetime.fromisoformat(str(value))
        return parsed.date().isoformat()
    except ValueError:
        pass
    try:
        parsed = datetime.strptime(str(value), "%m/%d/%Y")
        return parsed.date().isoformat()
    except ValueError:
        pass
    try:
        parsed = datetime.strptime(str(value), "%Y-%m-%d %H:%M:%S")
        return parsed.date().isoformat()
    except ValueError:
        return None


@dataclass
class MunicipalRosterSource:
    """Configuration describing how to query a municipal STR roster."""

    municipality: str
    layer_url: str
    schedule_field: str
    license_id_field: str
    status_field: str
    expiration_field: Optional[str] = None
    updated_field: Optional[str] = None
    where: str = "1=1"
    out_fields: Sequence[str] = field(default_factory=lambda: ["*"])
    detail_url_template: Optional[str] = None

    def build_query(self) -> Dict[str, Any]:
        out_fields = self.out_fields if self.out_fields else ["*"]
        return {
            "where": self.where or "1=1",
            "outFields": ",".join(out_fields),
            "returnGeometry": json.dumps(False),
        }


@dataclass
class MunicipalLicenseRecord:
    municipality: str
    schedule_number: str
    license_id: str
    status: str
    normalized_status: str
    expiration_date: Optional[str]
    updated_at: Optional[str]
    detail_url: Optional[str]
    raw: Dict[str, Any]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "municipality": self.municipality,
            "schedule_number": self.schedule_number,
            "municipal_license_id": self.license_id,
            "status": self.status,
            "normalized_status": self.normalized_status,
            "expiration_date": self.expiration_date,
            "updated_at": self.updated_at,
            "detail_url": self.detail_url,
            "raw": self.raw,
        }


def _iter_features(layer: FeatureLayer, source: MunicipalRosterSource) -> Iterable[Dict[str, Any]]:
    page_size = getattr(getattr(layer, "properties", None), "maxRecordCount", 1000) or 1000
    offset = 0
    while True:
        payload = layer.query(
            where=source.where or "1=1",
            out_fields=",".join(source.out_fields or ["*"]),
            return_geometry=False,
            result_offset=offset,
            result_record_count=page_size,
        ).to_dict()
        features = payload.get("features", [])
        if not features:
            break
        for feature in features:
            attributes = feature.get("attributes") or {}
            yield attributes
        if len(features) < page_size:
            break
        offset += page_size


def _build_detail_url(source: MunicipalRosterSource, attributes: Dict[str, Any]) -> Optional[str]:
    template = source.detail_url_template
    if not template:
        return None
    try:
        return template.format(**attributes)
    except KeyError:
        return None


def _extract_record(source: MunicipalRosterSource, attributes: Dict[str, Any]) -> Optional[MunicipalLicenseRecord]:
    schedule_value = attributes.get(source.schedule_field)
    schedule_number = _normalise_schedule_number(schedule_value)
    if not schedule_number:
        return None

    license_value = attributes.get(source.license_id_field)
    license_id = str(license_value).strip() if license_value not in (None, "") else None
    if not license_id:
        return None

    status_value = attributes.get(source.status_field)
    status = str(status_value).strip() if status_value not in (None, "") else "Unknown"
    normalized_status = _normalise_status(status_value)

    expiration_value = attributes.get(source.expiration_field) if source.expiration_field else None
    expiration_date = _parse_date(expiration_value)

    updated_value = attributes.get(source.updated_field) if source.updated_field else None
    updated_at = _parse_date(updated_value)

    detail_url = _build_detail_url(source, attributes)

    return MunicipalLicenseRecord(
        municipality=source.municipality,
        schedule_number=schedule_number,
        license_id=license_id,
        status=status or "Unknown",
        normalized_status=normalized_status,
        expiration_date=expiration_date,
        updated_at=updated_at,
        detail_url=detail_url,
        raw=dict(attributes),
    )


def _load_source_overrides() -> Dict[str, MunicipalRosterSource]:
    overrides_path = os.getenv("SUMMIT_MUNICIPAL_ROSTERS")
    if not overrides_path:
        return {}
    try:
        with open(overrides_path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except OSError as exc:  # pragma: no cover - defensive
        LOGGER.warning("Unable to read municipal roster overrides: %s", exc)
        return {}
    except json.JSONDecodeError as exc:  # pragma: no cover - defensive
        LOGGER.warning("Invalid JSON in municipal roster overrides: %s", exc)
        return {}

    overrides: Dict[str, MunicipalRosterSource] = {}
    for entry in payload:
        try:
            source = MunicipalRosterSource(
                municipality=entry["municipality"],
                layer_url=entry["layer_url"],
                schedule_field=entry["schedule_field"],
                license_id_field=entry["license_id_field"],
                status_field=entry["status_field"],
                expiration_field=entry.get("expiration_field"),
                updated_field=entry.get("updated_field"),
                where=entry.get("where", "1=1"),
                out_fields=entry.get("out_fields", ["*"]),
                detail_url_template=entry.get("detail_url_template"),
            )
        except KeyError as exc:
            LOGGER.warning("Skipping municipal roster override missing key %s", exc)
            continue
        overrides[source.municipality.lower()] = source
    return overrides


DEFAULT_MUNICIPAL_SOURCES: Dict[str, MunicipalRosterSource] = {
    "breckenridge": MunicipalRosterSource(
        municipality="Breckenridge",
        layer_url=os.getenv(
            "BRECKENRIDGE_ROSTER_URL",
            "https://services1.arcgis.com/DbqCQ5IIGIgjLU4g/arcgis/rest/services/STR_Licenses_Public/FeatureServer/0",
        ),
        schedule_field=os.getenv("BRECKENRIDGE_SCHEDULE_FIELD", "SCHEDULE_NUM"),
        license_id_field=os.getenv("BRECKENRIDGE_LICENSE_FIELD", "LICENSE_NO"),
        status_field=os.getenv("BRECKENRIDGE_STATUS_FIELD", "STATUS"),
        expiration_field=os.getenv("BRECKENRIDGE_EXPIRATION_FIELD", "EXPIRATION"),
        updated_field=os.getenv("BRECKENRIDGE_UPDATED_FIELD", "LAST_UPDATE"),
        detail_url_template=os.getenv(
            "BRECKENRIDGE_LICENSE_URL_TEMPLATE",
            "https://www.townofbreckenridge.com/str/{LICENSE_NO}",
        ),
    ),
    "frisco": MunicipalRosterSource(
        municipality="Frisco",
        layer_url=os.getenv(
            "FRISCO_ROSTER_URL",
            "https://services7.arcgis.com/r0nAYG7DmzNoKGbT/arcgis/rest/services/Frisco_STR_Licenses/FeatureServer/0",
        ),
        schedule_field=os.getenv("FRISCO_SCHEDULE_FIELD", "SCHEDULE"),
        license_id_field=os.getenv("FRISCO_LICENSE_FIELD", "LICENSE_NO"),
        status_field=os.getenv("FRISCO_STATUS_FIELD", "STATUS"),
        expiration_field=os.getenv("FRISCO_EXPIRATION_FIELD", "EXPIRATION"),
        updated_field=os.getenv("FRISCO_UPDATED_FIELD", "LASTUPDATED"),
    ),
    "dillon": MunicipalRosterSource(
        municipality="Dillon",
        layer_url=os.getenv(
            "DILLON_ROSTER_URL",
            "https://services7.arcgis.com/4W0wSZ3KFcuX39pB/arcgis/rest/services/Dillon_STR_Licenses/FeatureServer/0",
        ),
        schedule_field=os.getenv("DILLON_SCHEDULE_FIELD", "SCHEDULE"),
        license_id_field=os.getenv("DILLON_LICENSE_FIELD", "LICENSE_NO"),
        status_field=os.getenv("DILLON_STATUS_FIELD", "STATUS"),
        expiration_field=os.getenv("DILLON_EXPIRATION_FIELD", "EXPIRATION"),
        updated_field=os.getenv("DILLON_UPDATED_FIELD", "LAST_UPDATED"),
    ),
    "silverthorne": MunicipalRosterSource(
        municipality="Silverthorne",
        layer_url=os.getenv(
            "SILVERTHORNE_ROSTER_URL",
            "https://services7.arcgis.com/p0mEetxHUAZJr0qG/arcgis/rest/services/Silverthorne_STR_Licenses/FeatureServer/0",
        ),
        schedule_field=os.getenv("SILVERTHORNE_SCHEDULE_FIELD", "SCHEDULE"),
        license_id_field=os.getenv("SILVERTHORNE_LICENSE_FIELD", "LICENSE_NO"),
        status_field=os.getenv("SILVERTHORNE_STATUS_FIELD", "STATUS"),
        expiration_field=os.getenv("SILVERTHORNE_EXPIRATION_FIELD", "EXPIRATION"),
        updated_field=os.getenv("SILVERTHORNE_UPDATED_FIELD", "LAST_MODIFIED"),
    ),
}


def load_municipal_sources() -> Dict[str, MunicipalRosterSource]:
    sources = dict(DEFAULT_MUNICIPAL_SOURCES)
    overrides = _load_source_overrides()
    sources.update(overrides)
    return sources


def fetch_municipal_rosters(
    gis: GIS,
    *,
    sources: Optional[Dict[str, MunicipalRosterSource]] = None,
    logger: Optional[logging.Logger] = None,
) -> List[MunicipalLicenseRecord]:
    """Fetch and normalise STR licenses for all configured municipalities."""

    if sources is None:
        sources = load_municipal_sources()

    records: List[MunicipalLicenseRecord] = []

    for key, source in sources.items():
        if not source.layer_url:
            if logger:
                logger.warning("Municipal roster '%s' is missing a layer URL; skipping.", key)
            continue
        layer = FeatureLayer(source.layer_url, gis=gis)
        fetched = 0
        for attributes in _iter_features(layer, source):
            record = _extract_record(source, attributes)
            if record is None:
                continue
            records.append(record)
            fetched += 1
        if logger:
            logger.info("Fetched %s municipal STR licenses for %s.", fetched, source.municipality)

    return records


def dump_municipal_rosters(
    gis: GIS,
    *,
    output_path: Optional[str] = None,
    logger: Optional[logging.Logger] = None,
) -> Dict[str, Any]:
    records = fetch_municipal_rosters(gis, logger=logger)
    payload = {
        "generated_at": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "record_count": len(records),
        "records": [record.to_dict() for record in records],
    }
    if output_path:
        with open(output_path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2)
    return payload


__all__ = [
    "MunicipalRosterSource",
    "MunicipalLicenseRecord",
    "fetch_municipal_rosters",
    "dump_municipal_rosters",
    "load_municipal_sources",
]
