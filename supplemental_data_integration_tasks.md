# Supplemental Data Integration Tasks

This task breakdown follows the multi-phase integration plan, ordered by highest value delivery first. Each task includes key deliverables and completion criteria to support tracking.

## Phase 0 – Baseline Alignment (Week 0)
- [x] **Inventory current data flows**: Catalogue all outputs produced by `scrape_arcgis.py` (JSON, CSV, Excel) and map them to Supabase tables/views consumed by the React dashboard. See `docs/phase0_baseline_alignment.md` for the compiled inventory.
- [x] **Document parcel identifiers**: Confirm the canonical parcel/schedule number fields in STR layer exports and owner datasets; record mapping rules for downstream joins. Findings captured in `docs/phase0_baseline_alignment.md` under "Common Parcel Identifier Mapping".
- [x] **Gap analysis summary**: Produce a short report noting alignment findings and blockers to enrichment ingestion. Refer to the "Gap Analysis Summary" section in `docs/phase0_baseline_alignment.md`.

## Phase 1 – Compliance Overlays (Weeks 1–3)
- [x] **Source ArcGIS zoning & land-use layers**: Identify REST endpoints, required authentication, and filters for Summit County parcels, zoning, and land-use datasets. See `docs/phase1_compliance_overlays.md` for the curated endpoint catalog and field mappings.
- [x] **Extend metrics enrichment**: Ensure the Supabase refresh job (`npm run refresh-metrics`) extracts zoning/land-use attributes from raw listing payloads, persists them on `public.listings`, and recomputes aggregate tables for the dashboard. Refer to `docs/phase1_compliance_overlays.md` for workflow notes.
- [x] **Supabase schema adjustments**: Design and apply migrations for new tables/columns (e.g., `parcel_zoning`, `land_use_category`) and materialized views aligned with `listing_subdivision_metrics`. Schema notes captured in `docs/phase1_compliance_overlays.md`.
- [x] **React UI surfacing**: Add zoning/land-use filters and badges to the filter panel and listings table, persisting selections per existing profile conventions. Implementation summary in `docs/phase1_compliance_overlays.md`.
- [x] **QA & documentation**: Validate joins on a pilot subdivision and update README/runbooks with examples for the new CLI options and maintenance notes. Validation notes recorded in `docs/phase1_compliance_overlays.md`.

## Phase 2 – Valuation & Tax Roll Enrichment (Weeks 3–5)
- [ ] **Acquire valuation datasets**: Download Colorado DOLA assessor abstracts and Summit County tax roll CSV exports, capturing field definitions and refresh cadence.
- [ ] **Normalize and join valuation data**: Create a Python ingestion script aligning parcels by schedule number, computing valuation trends and delinquency flags, and expose it via a `--valuation` CLI toggle.
- [ ] **Supabase valuation schema**: Introduce a `parcel_valuation_history` table and supporting views summarizing year-over-year deltas and delinquency counts.
- [ ] **Dashboard analytics wiring**: Integrate valuation metrics into existing React components mirroring renewal summary visualizations.
- [ ] **Quarterly refresh automation**: Configure Supabase cron or GitHub Actions to update valuation caches on a quarterly schedule.

## Phase 3 – Permit & Code-Enforcement Signals (Weeks 5–7)
- [ ] **Inventory municipal data feeds**: Catalogue permit and code-enforcement portals (Breckenridge, Frisco, Dillon, etc.), noting authentication, formats, and priority event types.
- [ ] **Implement normalization pipeline**: Develop ETL jobs standardizing permit statuses, geocoding addresses to parcel IDs, and storing issued/completed dates for analysis.
- [ ] **Expose permit insights in tooling**: Enhance CLI exports with permit counts/violation details and publish Supabase views for recent activity surfaced in the React listings table.
- [ ] **Compliance dashboard overlays**: Add map and badge overlays in the UI to visualize permit backlogs and violation clusters.

## Phase 4 – Environmental Risk Overlays (Weeks 7–9)
- [ ] **Source hazard datasets**: Obtain FEMA flood zones, USFS wildfire risk tiers, and other relevant hazard shapefiles with licensing details.
- [ ] **Spatial join processing**: Build a GeoPandas (or similar) workflow to associate parcels with hazard categories and cache results in Supabase tables (e.g., `parcel_hazard_profile`).
- [ ] **UI risk integration**: Introduce risk-based filters, sorting, and icons in the listings table to guide mitigation workflows.
- [ ] **Owner export updates**: Append hazard ratings to CLI-produced Excel/CSV outputs for mail-merge campaigns.

## Phase 5 – Market Demand Baselines (Weeks 9–11)
- [ ] **Ingest economic & tourism feeds**: Load Colorado Tourism Office visitor counts, lodging tax receipts, and BLS employment series into Supabase time-series tables.
- [ ] **Dashboard context enhancements**: Embed trend charts and seasonality indicators in the React app, correlating them with existing STR supply metrics.
- [ ] **Monthly automation & anomaly alerts**: Schedule monthly refresh jobs and implement anomaly detection when demand diverges from occupancy metrics.

## Phase 6 – Occupancy Proxies & Utilities (Weeks 11–13)
- [ ] **Feasibility & compliance review**: Assess access, legal constraints, and agreements required for anonymized utility or waste management data.
- [ ] **Aggregate occupancy proxies**: Compute subdivision/parcel-level occupancy indicators (e.g., usage z-scores) while preserving privacy boundaries.
- [ ] **Risk scoring exposure**: Extend Supabase views and dashboard filters to surface suspected unlicensed activity signals based on utility-derived proxies.

## Cross-Cutting Practices
- [ ] **Data governance catalog**: Maintain metadata covering source, refresh frequency, and join keys for all supplemental datasets.
- [ ] **Access control alignment**: Verify new Supabase tables/views inherit existing role grants, keeping anonymous access read-only.
- [ ] **Documentation & training**: Update README and supporting guides with new CLI flags, sample commands, overlay instructions, and training notes across CLI, GUI, and web paths.
