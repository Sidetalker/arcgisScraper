#!/usr/bin/env bash
# finder.sh — One-shot Summit County FeatureServer endpoint finder

set -euo pipefail
IFS=$'\n\t'

BASE_E="https://gis.summitcountyco.gov/arcgis/rest/services"
BASE_P="https://summitcountyco.maps.arcgis.com"
OUT="./summit_endpoints_out"
mkdir -p "$OUT"

say(){ echo "[summit] $*"; }
get(){ curl -sS "$@"; }

say "=== Discovering folders on Enterprise ==="
ROOT=$(get "$BASE_E?f=pjson")
echo "$ROOT" >"$OUT/root.json"
jq -r '.folders[]?' "$OUT/root.json" >"$OUT/folders.txt"

say "=== Collecting all FeatureServer endpoints from Enterprise ==="
> "$OUT/all_endpoints.txt"
while read -r F; do
  [ -z "$F" ] && continue
  get "$BASE_E/$F?f=pjson" | jq -r --arg F "$F" '.services[]? | select(.type=="FeatureServer") | "https://gis.summitcountyco.gov/arcgis/rest/services/"+$F+"/"+.name+"/FeatureServer"' \
    >>"$OUT/all_endpoints.txt" 2>/dev/null || true
done <"$OUT/folders.txt"

# Hosted folder
get "$BASE_E/Hosted?f=pjson" | jq -r '.services[]? | select(.type=="FeatureServer") | "https://gis.summitcountyco.gov/arcgis/rest/services/Hosted/"+.name+"/FeatureServer"' \
  >>"$OUT/all_endpoints.txt" 2>/dev/null || true

say "=== Finding ArcGIS Online org ID for Summit County ==="
ORG_JSON=$(get "$BASE_P/sharing/rest/portals/self?f=json" || true)
echo "$ORG_JSON" >"$OUT/portal_self.json"
ORG_ID=$(jq -r '.id // empty' "$OUT/portal_self.json")
say "Org ID: ${ORG_ID:-unknown}"

say "=== Searching ArcGIS Online for STR layers and webmaps (org-scoped) ==="
# safer query encoding — no fancy characters
SEARCH_URL="https://www.arcgis.com/sharing/rest/search"
for TERM in "STR%20Licenses" "Short%20Term%20Rental%20Summit%20County" "STR%20Licenses%20October%202025"; do
  get "${SEARCH_URL}?q=${TERM}&num=100&f=json&orgid=${ORG_ID}" \
    | jq -r '.results[]? | .url? // empty' >>"$OUT/all_endpoints.txt" || true
done

say "=== Extracting operational layer URLs from public webmaps ==="
get "${SEARCH_URL}?q=orgid:${ORG_ID}%20(type:Web%20Map)%20Summit%20County&num=100&f=json" \
  | jq -r '.results[]?.id' \
  | grep -E '^[A-Za-z0-9]{32}$' \
  | while read -r WM; do
      [ -z "$WM" ] && continue
      get "https://www.arcgis.com/sharing/rest/content/items/${WM}/data?f=json" \
        | jq -r '.operationalLayers[]?.url // empty' >>"$OUT/all_endpoints.txt" 2>/dev/null || true
    done

say "=== Checking which endpoints actually respond ==="
> "$OUT/final_endpoints.txt"
sort -u "$OUT/all_endpoints.txt" | grep -E 'https://[^"]+/FeatureServer' | while read -r URL; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${URL}?f=pjson" || true)
  if [[ "$STATUS" == "200" ]]; then
    echo "$URL" | tee -a "$OUT/final_endpoints.txt"
  fi
done

say "=== Done. Working endpoints saved to $OUT/final_endpoints.txt ==="
echo
echo "Example query:"
echo "  curl -s '<endpoint>/0/query?where=1=1&outFields=*&resultRecordCount=1&f=json' | jq ."

