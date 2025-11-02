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
* [REST service directory entry](https://services7.arcgis.com/S70B1F1C0U4eOCNh/ArcGIS/rest/services/Short_Term_Rental_Public/FeatureServer)

Provide `--username/--password` or `--api-key` if you need access to secured
content or want to increase request limits.

## ArcGIS developer accounts and API keys

Anonymous requests are sufficient for the public Summit County data set, but
many ArcGIS Online services require an authenticated developer account. To
register and obtain an API key:

1. Create a free [ArcGIS Developer account](https://developers.arcgis.com/sign-up/) or sign in with an existing ArcGIS Online organization account.
2. Navigate to the [Dashboard](https://developers.arcgis.com/dashboard/) and open **New API key**.
3. Assign a descriptive name, choose the desired capability scopes (e.g., **Location services** for hosted feature layers), and click **Create API key**.
4. Copy the generated key and supply it to the scraper with `--api-key` when querying secured layers or when you need higher rate limits.

Refer to the [ArcGIS authentication guide](https://developers.arcgis.com/documentation/mapping-apis-and-services/security/) for detailed instructions on OAuth workflows, API key usage limits, and best practices for storing credentials.

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

Run `python scrape_arcgis.py --help` for the full list of supported flags.

The script prints the combined JSON response to stdout and optionally writes it
to the path specified by `--output`.

## Troubleshooting

Some corporate networks block anonymous requests to ArcGIS Online services. If
you encounter `Tunnel connection failed: 403 Forbidden` errors while running the
script, try rerunning from a different network or configure a proxy that
permits outbound HTTPS connections to `*.arcgis.com` and
`gis.summitcountyco.gov`.

