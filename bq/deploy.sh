#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-guidewaycare-476802}"
REGION="${GCP_REGION:-us-central1}"

echo "Deploying BigQuery schemas to project: $PROJECT_ID"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for sql_file in "$SCRIPT_DIR"/*.sql; do
  filename=$(basename "$sql_file")
  echo "Running $filename ..."
  
  query=$(sed "s/\${GCP_PROJECT_ID}/$PROJECT_ID/g" "$sql_file")
  
  bq query \
    --project_id="$PROJECT_ID" \
    --use_legacy_sql=false \
    --nouse_cache \
    "$query"
  
  echo "  Done."
done

echo "All BigQuery scripts executed successfully."
