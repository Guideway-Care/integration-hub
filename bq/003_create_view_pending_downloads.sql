CREATE OR REPLACE VIEW `${GCP_PROJECT_ID}.incontact.v_pending_downloads` AS
SELECT
  id,
  call_id,
  status,
  created_at,
  batch_id
FROM
  `${GCP_PROJECT_ID}.incontact.staging_call_queue`
WHERE
  status = 'pending'
ORDER BY
  created_at ASC,
  id ASC
LIMIT 1000;
