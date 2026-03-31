terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  backend "local" {}
}

provider "google" {
  project = var.project_id
  region  = var.region
}

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudscheduler.googleapis.com",
    "artifactregistry.googleapis.com",
    "bigquery.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "storage.googleapis.com",
    "servicenetworking.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "control_plane" {
  location      = var.region
  repository_id = "control-plane"
  format        = "DOCKER"
  description   = "Docker images for the API Controller Hub"

  depends_on = [google_project_service.apis]
}

resource "google_sql_database_instance" "main" {
  name             = "control-plane-db"
  database_version = "POSTGRES_15"
  region           = var.region

  settings {
    tier              = var.db_tier
    availability_type = var.db_ha ? "REGIONAL" : "ZONAL"

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.vpc.id
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "03:00"
    }

    database_flags {
      name  = "max_connections"
      value = "100"
    }
  }

  deletion_protection = true
  depends_on          = [google_project_service.apis, google_service_networking_connection.private_vpc]
}

resource "google_sql_database" "control_plane" {
  name     = "control_plane"
  instance = google_sql_database_instance.main.name
}

resource "google_sql_user" "app" {
  name     = "app"
  instance = google_sql_database_instance.main.name
  password = random_password.db_password.result
}

resource "random_password" "db_password" {
  length           = 32
  special          = true
  override_special = "-_~"
}

resource "google_compute_network" "vpc" {
  name                    = "control-plane-vpc"
  auto_create_subnetworks = false

  depends_on = [google_project_service.apis]
}

resource "google_compute_subnetwork" "main" {
  name          = "control-plane-subnet"
  ip_cidr_range = "10.0.0.0/24"
  region        = var.region
  network       = google_compute_network.vpc.id
}

resource "google_compute_global_address" "private_ip" {
  name          = "control-plane-private-ip"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "private_vpc" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip.name]
}

resource "google_service_account" "api_server" {
  account_id   = "api-server-sa"
  display_name = "API Controller Hub - API Server"
}

resource "google_service_account" "extraction_job" {
  account_id   = "extraction-job-sa"
  display_name = "API Controller Hub - Extraction Job"
}

resource "google_service_account" "incontact_job" {
  account_id   = "incontact-job-sa"
  display_name = "API Controller Hub - InContact Jobs"
}

resource "google_service_account" "scheduler" {
  account_id   = "scheduler-sa"
  display_name = "API Controller Hub - Cloud Scheduler"
}

resource "google_project_iam_member" "extraction_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.extraction_job.email}"
}

resource "google_project_iam_member" "extraction_bq_writer" {
  project = var.project_id
  role    = "roles/bigquery.dataEditor"
  member  = "serviceAccount:${google_service_account.extraction_job.email}"
}

resource "google_project_iam_member" "extraction_cloudsql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.extraction_job.email}"
}

resource "google_project_iam_member" "api_server_cloudsql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.api_server.email}"
}

resource "google_project_iam_member" "api_server_run_invoker" {
  project = var.project_id
  role    = "roles/run.invoker"
  member  = "serviceAccount:${google_service_account.api_server.email}"
}

resource "google_project_iam_member" "api_server_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.api_server.email}"
}

resource "google_project_iam_member" "api_server_bq_viewer" {
  project = var.project_id
  role    = "roles/bigquery.dataViewer"
  member  = "serviceAccount:${google_service_account.api_server.email}"
}

resource "google_project_iam_member" "api_server_bq_job_user" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.api_server.email}"
}

resource "google_project_iam_member" "incontact_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.incontact_job.email}"
}

resource "google_project_iam_member" "incontact_bq_editor" {
  project = var.project_id
  role    = "roles/bigquery.dataEditor"
  member  = "serviceAccount:${google_service_account.incontact_job.email}"
}

resource "google_project_iam_member" "incontact_storage_admin" {
  project = var.project_id
  role    = "roles/storage.objectAdmin"
  member  = "serviceAccount:${google_service_account.incontact_job.email}"
}

resource "google_project_iam_member" "scheduler_run_invoker" {
  project = var.project_id
  role    = "roles/run.invoker"
  member  = "serviceAccount:${google_service_account.scheduler.email}"
}

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github-pool"
  display_name              = "GitHub Actions Pool"

  depends_on = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-provider"
  display_name                       = "GitHub Actions Provider"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.actor"      = "assertion.actor"
    "attribute.repository" = "assertion.repository"
  }

  attribute_condition = "assertion.repository == '${var.github_repo}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "github_actions" {
  account_id   = "github-actions-sa"
  display_name = "GitHub Actions Deployment Service Account"
}

resource "google_service_account_iam_member" "github_wif" {
  service_account_id = google_service_account.github_actions.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}

resource "google_project_iam_member" "github_actions_ar_writer" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

resource "google_project_iam_member" "github_actions_run_admin" {
  project = var.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

resource "google_project_iam_member" "github_actions_sa_user" {
  project = var.project_id
  role    = "roles/iam.serviceAccountUser"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

resource "google_bigquery_dataset" "raw" {
  dataset_id  = "raw"
  location    = var.region
  description = "Raw API response payloads from extraction pipeline"
}

resource "google_bigquery_dataset" "incontact" {
  dataset_id  = "incontact"
  location    = var.region
  description = "InContact call recording data"
}

resource "google_storage_bucket" "incontact_audio" {
  name          = "${var.project_id}-incontact-audio"
  project       = var.project_id
  location      = var.region
  force_destroy = false

  lifecycle_rule {
    condition {
      age = 365
    }
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }
  }
}

resource "google_secret_manager_secret" "db_url" {
  secret_id = "database-url"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "db_url" {
  secret      = google_secret_manager_secret.db_url.id
  secret_data = "postgresql://${google_sql_user.app.name}:${random_password.db_password.result}@/${google_sql_database.control_plane.name}?host=/cloudsql/${google_sql_database_instance.main.connection_name}"
}
