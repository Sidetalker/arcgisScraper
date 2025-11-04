# ArcGIS Summit County Rental Explorer

This repository contains tools for exploring Summit County, CO short-term rental data. It now
includes a full-stack TypeScript web application that extends the original Python scraping
prototype.

## Project structure

- `scrape_arcgis.py` – Original Python CLI prototype for querying the ArcGIS layer.
- `server/` – Node.js + TypeScript API that proxies ArcGIS feature requests.
- `client/` – React + Vite + TypeScript single-page application for interactive exploration.

## Getting started

1. Install dependencies (uses npm workspaces):

   ```bash
   npm install
   ```

2. Start the development servers (runs the API on port `3000` and the web client on `5173` with a
   proxy back to the API):

   ```bash
   npm run dev
   ```

3. Build the production bundles:

   ```bash
   npm run build
   ```

   The Express server automatically serves the compiled React application from `client/dist` when
   present.

4. Launch the API in production mode (after building):

   ```bash
   npm start
   ```

## Key application features

- **Browser-side caching** – Feature data is cached in `localStorage` to avoid redundant network
  calls. Use the "Update All Data" toolbar button to purge and refresh the cache.
- **Dynamic filtering** – Every ArcGIS field is exposed as a live text filter with instant
  filtering of the dataset and results table.
- **Interactive geo regions** – Draw any number of circular regions directly on the map to focus on
  points of interest. Only properties that fall within the selected circles remain visible in the
  map and table views.

## Configuration

The server reads optional environment variables from a `.env` file at the repository root:

- `ARCGIS_LAYER_URL` – Override the ArcGIS feature layer URL.
- `ARCGIS_PORTAL_URL` – Reserved for future enhancements that require the ArcGIS portal context.
- `ARCGIS_REFERER` – Custom referer header if the ArcGIS service enforces domain restrictions.
- `PORT` – Port used by the Express server (defaults to `3000`).

## Future enhancements

- Authentication helpers for private ArcGIS content.
- Additional visualization widgets and analytics for rental evaluation workflows.
- Export tooling for curated property lists.
=======
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
`STR_Licenses_October_2025_public_view_layer` feature layer that powers the
public map experience referenced in the project brief. The layer is published as
part of the Summit County, Colorado short-term rental dashboard and is
discoverable through the following ArcGIS Online resources:

* [Experience Builder rental map](https://experience.arcgis.com/experience/706a6886322445479abadb904db00bc0)
* [Feature layer item details](https://summitcountyco.maps.arcgis.com/home/item.html?id=272448a44a304c6ca9265abbdc014fc7)
* [REST service directory entry](https://services6.arcgis.com/dmNYNuTJZDtkcRJq/arcgis/rest/services/STR_Licenses_October_2025_public_view_layer/FeatureServer)
* [Parcel point view (owner contact data)](https://services6.arcgis.com/dmNYNuTJZDtkcRJq/arcgis/rest/services/PrISM_APParcelPts_View_Layer_for_Query/FeatureServer)

Provide `--username/--password` or `--api-key` if you need access to secured
content or want to increase request limits. The CLI automatically checks the
`ARCGIS_API_KEY` environment variable when `--api-key` is omitted, making it
easy to keep credentials out of shell history and source control. Summit
County's Enterprise deployment also expects cross-domain requests to include a
`Referer` header that matches the county GIS host. The scraper sends
`https://experience.arcgis.com/experience/706a6886322445479abadb904db00bc0/` by default and honours an override supplied via
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
* `--owner-table` – emit a CSV owner contact table (best used with the PrISM parcel point view).
* `--all-subdivisions` – automatically enumerate every subdivision in the search window and query them one by one.
* `--excel-output` – write an `.xlsx` workbook with cross-linked “By Complex” and “By Owner” sheets.
* `--sheets-doc-id`, `--complex-gid`, `--owner-gid` – optional overrides for the Google Sheets document/GIDs used when
  prebuilding hyperlinks (defaults target your shared worksheet).
* `--rewrite-xlsx`/`--rewrite-output` – retarget hyperlinks inside an existing workbook without re-querying data.
* `--area LAT LNG RADIUS` – append additional search areas (supply multiple times to union several neighborhoods).

### Exporting owner mailing lists

The Summit County Experience Builder app sources owner contact information from
the `PrISM_APParcelPts_View_Layer_for_Query` view layer. Combine the new
`--owner-table` flag with that layer to produce a CSV that mirrors the county’s
mail-merge format. For example, to export Mountain Thunder owners:

```bash
python scrape_arcgis.py 39.4817 -106.0455 \
  --radius 500 \
  --layer-url https://services6.arcgis.com/dmNYNuTJZDtkcRJq/arcgis/rest/services/PrISM_APParcelPts_View_Layer_for_Query/FeatureServer/0 \
  --no-geometry \
  --all-subdivisions \
  --owner-table \
  --excel-output mountain-thunder.xlsx \
  --output mountain-thunder.csv
```

The CSV contains the columns expected by the county template:
`Complex`, `Unit`, an aggregated `Owner Name` (built from title/name/suffix or the
business name), a `Business Owner?` flag, a preformatted multi-line `Mailing Address`
column (ready for envelopes), split `Zip5`/`Zip9` columns, subdivision, schedule number,
and both a `Public Detail URL` (Summit County’s parcel page) and `Physical Address` (the
situs location). All of the raw name components still appear toward the end of the sheet
for reference, and the `Comments` column is left empty for human notes. Multiple owners
for a unit appear as individual rows sharing the same unit and schedule metadata.

Add `--where` if you need to narrow the subdivision set (for example, to a single
town or zoning district); the auto-enumeration logic will respect any additional
filters you supply.

When `--excel-output` is supplied alongside `--owner-table`, the tool also emits
an Excel workbook containing two tabs:

* **By Complex** – identical to the CSV export, plus an `Owner Link` column (next to the
  owner name) containing ready-to-open `HYPERLINK("https://docs.google.com/...", "OWN0001")` formulas.
* **By Owner** – consolidates properties by owner. Each property is listed on its own
  row (owner information repeats for convenience) and the `Complex Sheet Link` column
  uses the same hyperlink pattern to jump back to the matching complex row.

Open the **Instructions** tab inside the workbook for notes on updating the `--sheets-doc-id`
and gid flags if you copy the spreadsheet to a different Google Sheets document.

### Retargeting hyperlinks on an existing workbook

If you move the workbook to a different Google Sheets document (or need to regenerate links later), run:

```bash
python scrape_arcgis.py \
  --rewrite-xlsx summit-owners.xlsx \
  --rewrite-output summit-owners-updated.xlsx \
  --sheets-doc-id <NEW_DOC_ID> \
  --complex-gid <NEW_COMPLEX_GID> \
  --owner-gid <NEW_OWNER_GID>
```

The script rewrites all `By Complex` / `By Owner` hyperlinks in-place (or to the optional output file) and updates the
Instructions tab with the new identifiers.

## Optional GUI

Prefer a point-and-click workflow? Launch the bundled Tkinter GUI (ships with
Python on macOS and Windows) to run the same queries without typing long
commands:

```bash
python gui.py
```

The window lets you tweak the search parameters, toggle owner-table formatting,
and download the resulting JSON/CSV directly. Use the **Use STR Layer** or
**Use Owner Layer** shortcuts to jump between the public feature layer and the
parcel-point view.

Run `python scrape_arcgis.py --help` for the full list of supported flags.

The script prints the combined JSON response to stdout and optionally writes it
to the path specified by `--output`.

## Interactive web app

The repository also ships with a React + Vite single-page app that visualises
Summit County listings on top of an interactive map. The UI combines the region
builder, filter controls, and listing table in a single workspace and keeps the
results in sync as you draw, tweak filters, or refresh cached data.

### Web app setup

```bash
cd webapp/arcgis-webapp
npm install
npm run dev
```

Open the printed localhost URL to start exploring listings. The layout provides
three coordinated panels:

* **Search Regions** – draw circular regions on the Leaflet map. The geometry is
  persisted to `localStorage`, so a browser refresh restores the areas you were
  analysing.
* **Filter Listings** – adjust price, bedroom/bathroom counts, license status,
  or search by address. Filters apply instantly without reloading the page.
* **Listings table** – shows the rows that match the current geometry and
  filters, complete with pagination, loading states, and inline error handling
  if an ArcGIS request fails.

A status banner summarises the most recent fetch and whether results are being
served from cache. Use the **Refresh data** button to clear both the in-memory
ArcGIS client cache and the persisted browser cache; the app immediately
recomputes the query so you always know the data is fresh.

## Troubleshooting

Some corporate networks block anonymous requests to ArcGIS Online services. If
you encounter `Tunnel connection failed: 403 Forbidden` errors while running the
script, try rerunning from a different network or configure a proxy that
permits outbound HTTPS connections to `*.arcgis.com` and
`gis.summitcountyco.gov`.

### 400 `Invalid URL` or 404 `Not Found` responses

Summit County's ArcGIS Enterprise deployment validates the HTTP `Referer` header
on every feature-layer request. If the header is missing or does not match the
expected `https://experience.arcgis.com/` origin (or another county-hosted ArcGIS domain such
as `https://summitcountyco.maps.arcgis.com`), the server responds with JSON payloads such as
`{ "code": 400, "message": "Invalid URL" }` or falls back to an HTTP 404 response even when
the endpoint exists. The bundled scraper now sets the correct header automatically, but you
may see the same error when
experimenting with other HTTP clients or when pointing the CLI at a different
service that requires its own referer value.

To confirm you have the right endpoint and headers:

1. Open the [REST service directory](https://services6.arcgis.com/dmNYNuTJZDtkcRJq/arcgis/rest/services/STR_Licenses_October_2025_public_view_layer/FeatureServer/0?f=pjson)
   in a browser to verify the layer URL returns JSON.
2. Include a `Referer: https://experience.arcgis.com/` header (or use the
   scraper, which does this automatically) whenever you query the service.
3. Repeat your request. The layer should now return feature data instead of the
   400/404 error.
### Querying multiple search areas

Pass `lat`, `lng`, and `--radius` repeatedly to merge several search windows in one run. Duplicate properties (same
`Schedule Number`) are deduplicated automatically, so overlapping areas won't double count listings.

```bash
python scrape_arcgis.py 39.4817 -106.0455 --radius 400 \
  --area 39.506 -106.048 500 \
  --owner-table --excel-output summit-owners.xlsx
```