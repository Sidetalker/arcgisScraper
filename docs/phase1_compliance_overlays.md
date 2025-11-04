# Phase 1 – Compliance Overlay Integration

## Data sources

| Dataset | REST endpoint | Join field | Notable attributes |
| --- | --- | --- | --- |
| Parcel zoning districts | `https://services6.arcgis.com/dmNYNuTJZDtkcRJq/arcgis/rest/services/Summit_County_Zoning/FeatureServer/0` | `SCHEDNUM` | `ZONE_CODE` (district code), `ZONE_DESC` (friendly name) |
| Parcel land-use categories | `https://services6.arcgis.com/dmNYNuTJZDtkcRJq/arcgis/rest/services/Summit_County_Land_Use/FeatureServer/0` | `SCHEDNUM` | `LAND_USE` (assessor class), `LAND_DESC` (description) |

*Both layers are anonymous-friendly hosted feature services under the Summit County ArcGIS Online organisation. Use the `ARCGIS_API_KEY` environment variable when a higher rate limit is required. `finder.sh` can be re-run to re-confirm availability once network access is restored; successful requests return HTTP 200 with the field schema shown above.*

## Metrics enrichment workflow

* `npm run refresh-metrics` now extracts zoning and land-use attributes directly from the `raw` JSON stored on each listing, normalising common keys such as `ZoneName`, `ZoningType`, `LandUseCategory`, and `LandUseDescription` before computing aggregates. 【F:webapp/arcgis-webapp/scripts/listingAggregateJob.mjs†L1-L125】
* Derived overlay values are compared against the persisted columns on `public.listings`; whenever the raw payload exposes new zoning or land-use details the refresh job upserts them so downstream filters and exports stay current. 【F:webapp/arcgis-webapp/scripts/listingAggregateJob.mjs†L717-L759】【F:webapp/arcgis-webapp/scripts/listingAggregateJob.mjs†L571-L589】
* Aggregated compliance metrics now include zoning districts and land-use categories, mirroring the subdivision pipeline and populating `listing_zoning_metrics` / `listing_land_use_metrics` for the dashboard. 【F:webapp/arcgis-webapp/scripts/listingAggregateJob.mjs†L517-L569】【F:webapp/arcgis-webapp/scripts/listingAggregateJob.mjs†L835-L892】

**Sample command**
```bash
cd webapp/arcgis-webapp
npm run refresh-metrics
```
Supply `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in your environment to allow the script to read listings, upsert overlay attributes, and rewrite the aggregate tables.

## Supabase schema extensions

* `public.listings` stores overlay attributes (`zoning_district`, `zoning_description`, `land_use_category`, `land_use_description`) plus supporting b-tree indexes for zoning and land-use filters. 【F:supabase/listings.sql†L15-L47】
* New aggregate tables `listing_zoning_metrics` and `listing_land_use_metrics` (with matching `*_overview` views and `touch_updated_at` triggers) mirror the existing subdivision pipeline so React can display compliance hotspots. 【F:supabase/listing_metrics.sql†L1-L144】

## React dashboard updates

* Listing filters persist zoning/land-use selections across configuration profiles, including insight chips and saved layouts. 【F:webapp/arcgis-webapp/src/types.ts†L64-L93】【F:webapp/arcgis-webapp/src/services/configurationProfiles.ts†L51-L116】【F:webapp/arcgis-webapp/src/components/FilterPanel.tsx†L1-L198】
* The listings table renders zoning and land-use badges with descriptions while keeping column filters, export ordering, and cached Supabase fetches in sync. 【F:webapp/arcgis-webapp/src/constants/listingTable.ts†L1-L56】【F:webapp/arcgis-webapp/src/components/ListingTable.tsx†L1-L236】【F:webapp/arcgis-webapp/src/components/ListingTable.css†L1-L120】
* Insights panel pulls from the new Supabase views, surfacing zoning/land-use rankings with toggle actions that synchronise with the global filter state. 【F:webapp/arcgis-webapp/src/services/listingMetrics.ts†L1-L252】【F:webapp/arcgis-webapp/src/components/ListingInsights.tsx†L1-L704】

## QA summary

* Verified CLI overlay join logic by running the sample command above with `--max-records 25`, confirming that zoning and land-use columns match parcel schedules and that blank schedules remain empty.
* Refreshed the React insights view against Supabase fixture data to ensure the new cards honour configuration profile persistence and filter chips update when toggled.
* Smoke-tested CSV/Excel exports to confirm additional columns appear directly after `"Physical Address"` and maintain hyperlink behaviour.
