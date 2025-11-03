"""Minimal subset of the ArcGIS Python API needed for the scraper CLI."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict, Optional
from urllib.parse import urlencode, urljoin, urlparse
from urllib.request import ProxyHandler, Request, build_opener


class ArcGISError(RuntimeError):
    """Raised when the ArcGIS REST API reports an error."""


class GIS:
    """Simplified ArcGIS connection that supports API key authentication."""

    def __init__(
        self,
        portal_url: str,
        username: Optional[str] = None,
        password: Optional[str] = None,
        *,
        api_key: Optional[str] = None,
        anonymous: bool = False,
        referer: Optional[str] = None,
    ) -> None:
        self._portal_url = portal_url.rstrip("/")
        self._token: Optional[str] = None
        self._opener = build_opener(ProxyHandler({}))
        self._referer = referer.rstrip("/") if referer else None
        parsed_portal = urlparse(self._portal_url)
        self._portal_origin = f"{parsed_portal.scheme}://{parsed_portal.netloc}"

        if api_key:
            self._token = api_key
        elif username:
            if password is None:
                raise RuntimeError("Password is required when username is provided")
            self._token = self._generate_token(username, password)
        elif not anonymous:
            raise RuntimeError(
                "Authentication required: supply an API key or username/password"
            )

    @property
    def content(self) -> "ContentManager":
        return ContentManager(self)

    # ------------------------------------------------------------------
    # HTTP helpers
    def _generate_token(self, username: str, password: str) -> str:
        url = f"{self._portal_url}/sharing/rest/generateToken"
        data = {
            "f": "json",
            "username": username,
            "password": password,
            "client": "referer",
            "referer": self._portal_url,
        }
        payload = self._post(url, data)
        if "error" in payload:
            raise ArcGISError(json.dumps(payload["error"], sort_keys=True))
        token = payload.get("token")
        if not token:
            raise ArcGISError("ArcGIS did not return an authentication token")
        return token

    def _prepare_params(self, params: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        merged: Dict[str, Any] = {"f": "json"}
        if params:
            merged.update(params)
        if self._token:
            merged.setdefault("token", self._token)
        return merged

    def _default_headers(self, request_url: str) -> Dict[str, str]:
        referer = self._portal_url
        parsed = urlparse(request_url)
        request_origin = f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme else ""
        if self._referer and request_origin and request_origin != self._portal_origin:
            referer = self._referer
        return {
            "Referer": referer,
            "User-Agent": "arcgis-scraper/0.1",
        }

    def _post(self, url: str, params: Dict[str, Any]) -> Dict[str, Any]:
        encoded = urlencode(params).encode("utf-8")
        request = Request(url, data=encoded, headers=self._default_headers(url))
        with self._opener.open(request, timeout=60) as response:
            body = response.read().decode("utf-8")
        return json.loads(body)

    def _get(self, url: str, params: Dict[str, Any]) -> Dict[str, Any]:
        query = urlencode(params)
        request_url = f"{url}?{query}" if query else url
        request = Request(request_url, headers=self._default_headers(request_url))
        with self._opener.open(request, timeout=60) as response:
            body = response.read().decode("utf-8")
        return json.loads(body)

    def request(self, url: str, *, method: str = "GET", params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        prepared = self._prepare_params(params)
        request_url = url if url.startswith("http") else urljoin(self._portal_url + "/", url)
        if method.upper() == "POST":
            payload = self._post(request_url, prepared)
        else:
            payload = self._get(request_url, prepared)
        if isinstance(payload, dict) and "error" in payload:
            raise ArcGISError(json.dumps(payload["error"], sort_keys=True))
        return payload


class ContentManager:
    def __init__(self, gis: GIS) -> None:
        self._gis = gis

    def get(self, item_id: str) -> "Item":
        path = f"/sharing/rest/content/items/{item_id}"
        metadata = self._gis.request(path)
        if not metadata:
            raise ArcGISError(f"Item '{item_id}' not found")
        return Item(self._gis, metadata)


@dataclass
class Item:
    _gis: GIS
    _metadata: Dict[str, Any]

    @property
    def id(self) -> Optional[str]:  # pragma: no cover - simple passthrough
        return self._metadata.get("id")

    @property
    def url(self) -> Optional[str]:
        return self._metadata.get("url")

    @property
    def layers(self) -> list:
        from .features import FeatureLayer  # local import to avoid cycle

        service_url = self.url
        if not service_url:
            return []
        info = self._gis.request(service_url)
        layer_defs = info.get("layers", [])
        return [FeatureLayer(f"{service_url}/{layer['id']}", gis=self._gis) for layer in layer_defs]
