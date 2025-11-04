# Contributor Guidelines

## Repository overview

This project combines a Python command-line scraper, a lightweight ArcGIS API compatibility layer, a Tkinter-based desktop helper, and a Vite + React web client that caches and visualises Summit County short-term rental data. The CLI (`scrape_arcgis.py`) drives most of the automation: it authenticates against the Summit County ArcGIS portal, queries the STR feature layer, and formats listings, owner contact tables, and Excel exports. The `arcgis/` package implements the minimal subset of the ArcGIS Python API that the CLI relies on so the tool can run without the official dependency. A simple GUI (`gui.py`) wraps the same logic for interactive use. The `webapp/arcgis-webapp/` directory hosts the TypeScript SPA that interacts with Supabase for cached datasets and exposes search, filtering, and syncing workflows. Supporting artefacts (sample workbooks, JSON dumps, and SQL schema) live alongside the source to document expected outputs.

## Working with the Python tooling

* Target Python 3.11+ and keep type hints up to date. The existing modules treat type safety seriously; annotate new functions and prefer `dataclass` containers when representing structured data.
* Follow the established logging and error-handling patterns in `scrape_arcgis.py`. Raise `RuntimeError` for user-facing CLI errors and let `ArcGISError` bubble when the REST API reports issues.
* Preserve compatibility with the minimal `arcgis` shim. If you need additional REST helpers, extend the local implementation instead of importing the official `arcgis` package.
* Keep CLI option parsing declarative and update the README usage examples when you introduce new flags or behaviours.
* When emitting CSV/Excel data, reuse the existing formatting helpers to guarantee that downstream mail-merge workflows remain stable.

## Working with the GUI

* `gui.py` should remain a thin wrapper over the CLI helpers. Avoid duplicating business logic; call into `scrape_arcgis` for all network or formatting work.
* Keep the UI responsive by performing long-running operations on background threads as the current implementation does.

## Working with the React web app

* The web client lives under `webapp/arcgis-webapp/` and follows a TypeScript + Vite stack with React Router. Maintain strict typing, and prefer hooks/context utilities that already exist in `src/context` and `src/hooks`.
* Style updates should stick to the BEM-like class names defined in `App.css` and related component styles. When adding new assets, organise them under `src/assets/`.
* Use Supabase client helpers in `src/services` for persistence; avoid sprinkling direct `fetch` calls throughout components.
* Tests reside in `src/__tests__`. Add Vitest/React Testing Library coverage when you modify complex UI or data flows.

## Tooling and commands

* Python scripts do not ship a dedicated test suite, but you can run targeted smoke checks via the CLI, for example:
  ```bash
  python scrape_arcgis.py 39.4817 -106.0455 --radius 100 --no-geometry
  ```
* The React app uses npm scripts:
  ```bash
  cd webapp/arcgis-webapp
  npm install
  npm run lint
  npm run test
  npm run dev
  ```
  Run `npm run build` before committing large UI changes to confirm the Vite build passes.

## General practices

* Keep credentials, API keys, and service configurations in environment variables. Never commit secrets or generated JSON dumps that contain sensitive data.
* Large sample workbooks (`*.xlsx`) are versioned for reference; avoid rewriting them unless the schema changes. When you do update them, explain the rationale in your commit message.
* Document notable behaviours and integration steps in `README.md` or dedicated docs so contributors understand both the CLI and web workflows.
