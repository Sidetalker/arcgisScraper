# Summit County STR Explorer

Summit County's short-term rental registry is published as an ArcGIS feature layer. This project packages a full-featured web
application that lets you draw custom geographic search regions, download the associated permit records, and explore the data
with live filters. All ArcGIS responses are cached directly in the browser so repeat queries are instant, and a single click can
refresh everything when you need a clean slate.

## Key capabilities

- **Interactive region builder.** Use the map to draw any number of circular search regions. Circles can be moved or resized at
  any time and the application automatically synchronises the fetched data.
- **Local caching with manual refresh.** Query results are stored in `localStorage`. Cached responses are reused when you redraw a
  previously queried area. The “Update all data” action wipes the cache and forces fresh ArcGIS requests for every region.
- **Realtime filtering.** Add as many filter rules as you need. Every field exposed by the feature layer is available for
  substring matches and the table updates immediately as you type.
- **Flexible table layout.** Toggle which fields should be visible, inspect the combined results from every active region, and see
  how many rows match the current filters.

## Getting started

The app is written in TypeScript with Vite + React. Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Open the printed local URL (typically http://localhost:5173/) in your browser. Vite reloads the UI automatically as you edit the
source.

For a production build run:

```bash
npm run build
npm run preview
```

`npm run preview` serves the compiled assets so you can verify the optimised bundle before deployment.

## Using the explorer

1. Draw one or more search regions directly on the map. Each circle defines a centre point (latitude/longitude) and radius in
   metres.
2. The application queries Summit County’s public short-term rental layer (`STR_Licenses_October_2025_public_view_layer`) for
   every region and caches the responses.
3. Use the filter panel to add rules such as “City contains Breckenridge” or “Status contains Active”. All filters are applied in
   realtime across the combined dataset.
4. Toggle table fields to focus on the columns that matter to you. A running total shows how many permits match the current
   configuration.
5. Click **Update all data** whenever you want to discard cached responses and trigger a fresh download for each region.

Cached entries survive page reloads because they are stored in `localStorage`. If you want to start over from scratch, simply
clear browser storage or press the Update button inside the app.

## Data source and authentication

The explorer targets the public Summit County ArcGIS Online organisation and uses anonymous access by default. If you have a
paid ArcGIS account with higher rate limits you can update `src/services/arcgis.ts` to inject the relevant authentication
headers (for example an API key) before building the project.

## Legacy Python tooling

The original repository shipped a command-line scraper and Tkinter GUI powered by the official ArcGIS Python API. The scripts are
still included for reference (`scrape_arcgis.py` and `gui.py`) but the recommended workflow is now the web explorer described
above.
