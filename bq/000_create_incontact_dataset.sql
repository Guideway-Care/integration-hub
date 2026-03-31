CREATE SCHEMA IF NOT EXISTS `${GCP_PROJECT_ID}.incontact`
OPTIONS (
  location = 'us-central1',
  description = 'InContact call recording data managed by API Controller Hub'
);
