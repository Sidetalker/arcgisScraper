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
