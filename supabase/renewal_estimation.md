# Renewal estimation and parcel data catalog

This document explains which data fields are available from the Summit County parcel dataset and how the metrics worker infers renewal windows now that the raw listings no longer expose an explicit `renewal` or `expiration` attribute. The goal is to make the heuristics transparent so they can be tuned as new parcel signals become available.

## Parcel data overview

The ArcGIS parcel payload contains a rich mix of assessor- and recorder-sourced attributes. The table below groups the most common properties the worker sees today.

| Category | Key fields and notes |
| --- | --- |
| Ownership & mailing | `Owner Name`, `Owner Name 2`, `Mail Address 1/2/3`, `City`, `State`, `Zip`, `Phys Address`. Useful for differentiating individual versus business ownership and confirming absentee owners. |
| Parcel identity | `Schedule Number` / parcel ID, `Subdivision`, `SubCode`, `Block`, `Lot`, `Phase`, economic area (`Econ`), `Neighborhood`, `TaxArea`, township / range / section references. These identifiers tie the record back to GIS geometry and zoning resources. |
| Valuation & tax | Year-specific `Actual Value`, `Assessed Value`, `Land Value`, `Improvement Value`, `Estimated Tax`, mill levy (`Tax Rate`), `Assessment Year`, and appeal or override markers. These values refresh on the Colorado odd-year reassessment cadence. |
| Structure details | `Year Built`, `Adjusted Year`, bedroom / bathroom counts, total rooms, finished square footage, garage and parking details, heating / cooling utilities, basement flags, construction quality, and remodel indicators. |
| Site characteristics | Lot acreage, zoning overlays, sewer / water providers, topography, view / tree cover indicators, HOA or neighborhood services. |
| Sales & recording history | Arrays of reception entries that include `Reception #`, `Document Type`, `Sale Date`, `Sale Price`, grantor / grantee names, deed references, mortgage releases, and occasionally contract dates. Each reception is tied to a recording timestamp from the clerk & recorder. |
| Administrative metadata | General timestamps such as `Entered`, `Modified`, `Capture Date`, GIS feature `OBJECTID`, and data source provenance flags. |

Not every field is populated for every parcel, but the mix above has been consistent across the Summit County exports tested so far.

## Renewal estimation strategy

Because the listings table now lacks a direct license expiration, the aggregation job (`webapp/arcgis-webapp/scripts/listingAggregateJob.mjs`) synthesises an estimated renewal window from the parcel metadata. The workflow:

1. **Scan for date signals** – The worker recursively walks the `raw` parcel JSON, looking for keys that resemble dates (`date`, `year`, `reception`, `sale`, `permit`, `assessment`, `updated`, etc.) or for string values that clearly contain date patterns (ISO strings, `MM/DD/YYYY`, or month names).
2. **Classify each signal** – Keys are matched against heuristic buckets:
   * `permit` – anything mentioning `license`, `permit`, `renew`, or `expiration`.
   * `transfer` – `sale`, `deed`, `reception`, `record`, `document`, or `transfer` references.
   * `assessment` – assessor language such as `assess`, `valuation`, `actualvalue`, `marketvalue`, `taxyear`, or `levy`.
   * `update` – generic update terms like `updated`, `modified`, `entered`, or `capture`.
   * `generic` – every other timestamp that still looks date-like.
3. **Normalise values** – The parser understands ISO strings, ArcGIS `/Date(1664419200000)/` wrappers, Unix epochs, Excel-style serial numbers, and bare years (converted to `YYYY-01-01`).
4. **Project the next renewal** – Signals are evaluated in priority order:
   * Use the **nearest permit date** when present (`direct_permit`). Future permits are taken as-is; historical permits are treated as overdue but still surfaced.
   * Otherwise, take the latest **ownership transfer** event and project it forward on a one-year cadence (`transfer_cycle`). The loop keeps rolling one year at a time until the estimate lands in the future.
   * If no transfer exists, extrapolate from the most recent **assessment** year by jumping to the next odd-year reassessment window (Colorado reassesses every two years on odd years) and assuming a May 1 effective date (`assessment_cycle`).
   * If assessment data is missing, fall back to a yearly cadence anchored to the newest general update (`update_cycle`).
   * As a final guardrail, use the newest timestamp of any type and roll it forward one year (`generic_cycle`).
5. **Summarise results** – Estimated dates feed the existing timeline and urgency buckets. The worker also counts how many listings relied on each inference method so the frontend can explain the underlying signals.

Listings without any qualifying timestamp fall into the `missing` bucket, signalling that manual research is required.

## Metrics persistence

`supabase/listing_metrics.sql` provisions three aggregate tables and one helper table that are refreshed by the worker:

* `listing_subdivision_metrics` – counts by subdivision and ownership type.
* `listing_renewal_metrics` – monthly buckets of estimated renewals (earliest/latest per month).
* `listing_renewal_summary` – urgency categories (overdue, 30/60/90-day windows, future, missing).
* `listing_renewal_method_summary` – count of listings per estimation strategy (`direct_permit`, `transfer_cycle`, etc.).

The script exposes read-only views for each table so the web app can fetch the latest aggregates without recalculating them. All views include an `updated_at` timestamp for freshness checks.

## Future improvements

* **Supabase storage** – Persisting the raw signal classification per listing would unlock parcel-level debugging in the UI.
* **Recorder integrations** – Pulling live clerk & recorder filings would provide richer transfer cycles and help confirm whether the yearly cadence aligns with local policy.
* **Assessment calendar tuning** – The current reassessment projection assumes May 1; adjust the anchor date if the county publishes more precise valuation release timelines.
