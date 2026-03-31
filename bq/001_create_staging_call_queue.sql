CREATE TABLE IF NOT EXISTS `${GCP_PROJECT_ID}.incontact.staging_call_queue` (
  id              STRING NOT NULL,
  call_id         STRING NOT NULL,
  status          STRING NOT NULL,
  error_message   STRING,
  created_at      TIMESTAMP NOT NULL,
  processed_at    TIMESTAMP,
  batch_id        STRING
)
OPTIONS (
  description = 'Staging load table for InContact call recording downloads. Cloud Run job reads pending rows sequentially, fetches metadata + MP4 from MediaPlayback API, uploads to gs://incontact-audio/, then marks status as downloaded.',
  labels = [("pipeline", "incontact"), ("stage", "staging")]
);
