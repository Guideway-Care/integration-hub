CREATE TABLE IF NOT EXISTS `${GCP_PROJECT_ID}.incontact.call_recordings` (
  id                  STRING NOT NULL,
  contact_id          STRING NOT NULL,
  acd_contact_id      STRING NOT NULL,
  agent_id            STRING,
  agent_name          STRING,
  start_date          TIMESTAMP,
  end_date            TIMESTAMP,
  duration_seconds    INT64,
  media_type          STRING,
  direction           STRING,
  file_name           STRING,
  gcs_uri             STRING,
  file_size_bytes     INT64,
  sentiment           STRING,
  categories          STRING,
  call_tags           STRING,
  raw_json            STRING,
  ingestion_timestamp TIMESTAMP NOT NULL
)
OPTIONS (
  description = 'Destination table for InContact call recording metadata. Each row represents a processed call with agent info, duration, direction, GCS file location, sentiment, categories, and tags.',
  labels = [("pipeline", "incontact"), ("stage", "destination")]
);
