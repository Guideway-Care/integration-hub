import { BigQuery } from "@google-cloud/bigquery";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { Storage as GCSStorage } from "@google-cloud/storage";

const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID || "guidewaycare-476802";

function getGcpCredentials(): { credentials?: any } {
  const gcpKey = process.env.GCP_SERVICE_ACCOUNT_KEY;
  if (gcpKey) {
    return { credentials: JSON.parse(gcpKey) };
  }
  return {};
}

export function getBigQueryClient(location?: string) {
  return new BigQuery({ projectId: GCP_PROJECT_ID, ...(location ? { location } : {}), ...getGcpCredentials() });
}

export function getGCSClient() {
  return new GCSStorage({ projectId: GCP_PROJECT_ID, ...getGcpCredentials() });
}

export async function getGcpSecretManagerClient() {
  const creds = getGcpCredentials();
  const client = new SecretManagerServiceClient(creds);
  return { client, projectId: GCP_PROJECT_ID };
}

export async function getSecretValue(
  client: SecretManagerServiceClient,
  projectId: string,
  secretName: string,
): Promise<string> {
  const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;
  const [version] = await client.accessSecretVersion({ name });
  const value = version.payload?.data?.toString();
  if (!value) throw new Error(`Secret ${secretName} is empty`);
  return value;
}

export function getGcpProjectId(): string {
  return GCP_PROJECT_ID;
}
