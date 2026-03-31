variable "project_id" {
  description = "GCP project ID"
  type        = string
  default     = "guidewaycare-476802"
}

variable "region" {
  description = "GCP region for all resources"
  type        = string
  default     = "us-central1"
}

variable "db_tier" {
  description = "Cloud SQL machine tier"
  type        = string
  default     = "db-f1-micro"
}

variable "db_ha" {
  description = "Enable high availability for Cloud SQL"
  type        = bool
  default     = false
}

variable "github_repo" {
  description = "GitHub repository in format 'owner/repo'"
  type        = string
  default     = "Guideway-Care/integration-hub"
}
