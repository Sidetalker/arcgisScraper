# ArcGIS Scraper

This repository contains a command-line tool that uses the official ArcGIS
Python API to query Summit County, Colorado's hosted short-term rental feature
layer. The script builds a small search area around a latitude/longitude and
prints the raw JSON response so you can inspect what data is available before
building more targeted scraping logic.

## Setup

The scraper targets the [ArcGIS Python API](https://developers.arcgis.com/python/latest/)
and has been tested with Python 3.11. Install dependencies into your preferred
environment:

```bash
python -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install arcgis
```

The default configuration authenticates anonymously against the
`summitcountyco.maps.arcgis.com` organization and queries the hosted
`Short_Term_Rental_Public` feature layer that powers the public map experience
referenced in the project brief. The layer is published as part of the Summit
County, Colorado Short-Term Rental dashboard and is discoverable through the
following ArcGIS Online resources:

* [Experience Builder rental map](https://experience.arcgis.com/experience/706a6886322445479abadb904db00bc0)
* [Feature layer item details](https://summitcountyco.maps.arcgis.com/home/item.html?id=5a97d3b5a6b94f15b3d5b1ef82b5f9ab)
* [REST service directory entry](https://gis.summitcountyco.gov/server/rest/services/Hosted/Short_Term_Rental_Public/FeatureServer)

Provide `--username/--password` or `--api-key` if you need access to secured
content or want to increase request limits. The CLI automatically checks the
`ARCGIS_API_KEY` environment variable when `--api-key` is omitted, making it
easy to keep credentials out of shell history and source control. Summit
County's Enterprise deployment also expects cross-domain requests to include a
`Referer` header that matches the county GIS host. The scraper sends
`https://gis.summitcountyco.gov` by default and honours an override supplied via
`--referer` or the `ARCGIS_REFERER` environment variable when you need to target
different services.

## ArcGIS developer accounts and API keys

Anonymous requests are sufficient for the public Summit County data set, but
many ArcGIS Online services require an authenticated developer account. Follow
the step-by-step playbook in [API_ACCESS.md](API_ACCESS.md) to create a developer
account, generate an API key, and store the credentials for use with the
scraper.

## Usage

```bash
python scrape_arcgis.py <LATITUDE> <LONGITUDE> [options]
```

Example: fetch all short-term rental listings within 400 meters of Breckenridge's
Main Street and save the raw payload to disk.

```bash
python scrape_arcgis.py 39.4817 -106.0455 --radius 400 --output breck.json
```

Key options:

* `--where` – supply additional filters such as `"Status = 'Active'"`.
* `--no-geometry` – drop geometry payloads when you only need attributes.
* `--layer-url` – point at a different feature layer (or use `--item-id` and
  `--layer-index` to resolve a layer from ArcGIS Online content).
* `--referer` – customise the HTTP referer header if the target service enforces
  a different host check.

Run `python scrape_arcgis.py --help` for the full list of supported flags.

The script prints the combined JSON response to stdout and optionally writes it
to the path specified by `--output`.

## Troubleshooting

Some corporate networks block anonymous requests to ArcGIS Online services. If
you encounter `Tunnel connection failed: 403 Forbidden` errors while running the
script, try rerunning from a different network or configure a proxy that
permits outbound HTTPS connections to `*.arcgis.com` and
`gis.summitcountyco.gov`.

### 400 `Invalid URL` or 404 `Not Found` responses

Summit County's ArcGIS Enterprise deployment validates the HTTP `Referer` header
on every feature-layer request. If the header is missing or does not match the
expected `https://gis.summitcountyco.gov` origin, the server responds with JSON
payloads such as `{ "code": 400, "message": "Invalid URL" }` or falls back to
an HTTP 404 response even when the endpoint exists. The bundled scraper now sets
the correct header automatically, but you may see the same error when
experimenting with other HTTP clients or when pointing the CLI at a different
service that requires its own referer value.

To confirm you have the right endpoint and headers:

1. Open the [REST service directory](https://gis.summitcountyco.gov/server/rest/services/Hosted/Short_Term_Rental_Public/FeatureServer/0?f=pjson)
   in a browser to verify the layer URL returns JSON.
2. Include a `Referer: https://gis.summitcountyco.gov` header (or use the
   scraper, which does this automatically) whenever you query the service.
3. Repeat your request. The layer should now return feature data instead of the
   400/404 error.

