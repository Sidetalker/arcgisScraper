# ArcGIS Scraper

This repository contains a simple command-line tool that queries ArcGIS REST
FeatureServer layers around a latitude/longitude and prints the raw JSON
response. It is a starting point for exploring what data is available for a
particular layer before building more specialized scraping logic.

## Setup

The script only depends on the Python standard library (tested with Python 3.11),
so there is no additional installation step beyond creating an optional virtual
environment if you prefer.

## Usage

```bash
python scrape_arcgis.py <LATITUDE> <LONGITUDE> [--radius METERS] [--service-url URL]
```

Example querying a public parcel dataset with a 500 meter radius:

```bash
python scrape_arcgis.py 37.7749 -122.4194 --radius 500
```

Use `--output path/to/file.json` to save the response to disk.
