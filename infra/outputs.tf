output "cloud_sql_connection_name" {
  description = "Cloud SQL instance connection name for Cloud Run"
  value       = google_sql_database_instance.main.connection_name
}

output "artifact_registry_url" {
  description = "Artifact Registry URL for Docker images"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.control_plane.repository_id}"
}

output "wif_provider" {
  description = "Workload Identity Federation provider for GitHub Actions"
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "wif_service_account" {
  description = "Service account email for GitHub Actions WIF"
  value       = google_service_account.github_actions.email
}

output "api_server_service_account" {
  description = "API server Cloud Run service account"
  value       = google_service_account.api_server.email
}

output "extraction_job_service_account" {
  description = "Extraction job service account"
  value       = google_service_account.extraction_job.email
}

output "incontact_job_service_account" {
  description = "InContact job service account"
  value       = google_service_account.incontact_job.email
}

output "scheduler_service_account" {
  description = "Cloud Scheduler service account"
  value       = google_service_account.scheduler.email
}
