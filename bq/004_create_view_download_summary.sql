CREATE OR REPLACE VIEW `${GCP_PROJECT_ID}.incontact.v_download_summary` AS
SELECT
  batch_id,
  COUNT(*) AS total_calls,
  COUNTIF(status = 'pending') AS pending,
  COUNTIF(status = 'processing') AS processing,
  COUNTIF(status = 'downloaded') AS downloaded,
  COUNTIF(status = 'failed') AS failed,
  ROUND(SAFE_DIVIDE(COUNTIF(status = 'downloaded'), COUNT(*)) * 100, 1) AS pct_complete,
  MIN(created_at) AS batch_started,
  MAX(processed_at) AS last_processed
FROM
  `${GCP_PROJECT_ID}.incontact.staging_call_queue`
GROUP BY
  batch_id
ORDER BY
  batch_started DESC;
