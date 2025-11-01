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
referenced in the project brief. Provide `--username/--password` or `--api-key`
if you need access to secured content.

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

