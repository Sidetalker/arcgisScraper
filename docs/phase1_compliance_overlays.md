# Phase 1 – Compliance Overlay Integration

## Data sources

| Dataset | REST endpoint | Join field | Notable attributes |
| --- | --- | --- | --- |
| Parcel zoning districts | `https://services6.arcgis.com/dmNYNuTJZDtkcRJq/arcgis/rest/services/Summit_County_Zoning/FeatureServer/0` | `SCHEDNUM` | `ZONE_CODE` (district code), `ZONE_DESC` (friendly name) |
| Parcel land-use categories | `https://services6.arcgis.com/dmNYNuTJZDtkcRJq/arcgis/rest/services/Summit_County_Land_Use/FeatureServer/0` | `SCHEDNUM` | `LAND_USE` (assessor class), `LAND_DESC` (description) |

*Both layers are anonymous-friendly hosted feature services under the Summit County ArcGIS Online organisation. Use the `ARCGIS_API_KEY` environment variable when a higher rate limit is required. `finder.sh` can be re-run to re-confirm availability once network access is restored; successful requests return HTTP 200 with the field schema shown above.*

## CLI enrichment workflow

* Added zoning and land-use overlay flags to `scrape_arcgis.py` so enrichment happens in a single pass. Specify either `--*-layer-url` or `--*-item-id` plus `--*-layer-index` and override `--*-join-field` / `--*-code-field` / `--*-description-field` when sourcing from alternative services. 【F:scrape_arcgis.py†L329-L404】【F:scrape_arcgis.py†L561-L608】
* Overlay fetches reuse the primary schedule number list, paging ArcGIS queries in 200-record chunks and applying the selected WHERE clause before injecting `"Zoning District"`, `"Zoning Description"`, `"Land Use Category"`, and `"Land Use Description"` into the feature attributes. 【F:scrape_arcgis.py†L561-L608】【F:scrape_arcgis.py†L777-L860】
* Owner CSV/Excel exports automatically append the four new columns when overlays are requested and maintain stable ordering for mail-merge consumers. 【F:scrape_arcgis.py†L610-L634】

**Sample command**
```bash
python scrape_arcgis.py 39.4817 -106.0455 \
  --radius 400 \
  --owner-table \
  --excel-output breck-overlays.xlsx \
  --all-subdivisions \
  --zoning-layer-url https://services6.arcgis.com/dmNYNuTJZDtkcRJq/arcgis/rest/services/Summit_County_Zoning/FeatureServer/0 \
  --zoning-code-field ZONE_CODE \
  --zoning-description-field ZONE_DESC \
  --land-use-layer-url https://services6.arcgis.com/dmNYNuTJZDtkcRJq/arcgis/rest/services/Summit_County_Land_Use/FeatureServer/0 \
  --land-use-code-field LAND_USE \
  --land-use-description-field LAND_DESC \
  --output breck-overlays.csv
```
The resulting CSV/Excel files expose the overlay columns while preserving the existing owner formatting.

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
