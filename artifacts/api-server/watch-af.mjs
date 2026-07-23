import { GoogleAuth } from "google-auth-library";
import { BigQuery } from "@google-cloud/bigquery";
const key = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY);
const auth = new GoogleAuth({ credentials: key, scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
const client = await auth.getClient();
const ex = await client.request({ url: "https://run.googleapis.com/v2/projects/guidewaycare-476802/locations/us-central1/jobs/audioflow-processor/executions/audioflow-processor-6b72h" });
console.log("execution:", JSON.stringify({ done: ex.data.completionTime || "RUNNING", succeeded: ex.data.succeededCount || 0, failed: ex.data.failedCount || 0 }));
const bq = new BigQuery({ projectId: "guidewaycare-476802", credentials: key });
const [snap] = await bq.query({
  query: `SELECT COUNT(*) AS transcribed_last_15min,
                 (SELECT COUNT(*) FROM incontact_transcripts.calls) AS total
          FROM incontact_transcripts.calls
          WHERE processed_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 15 MINUTE)`,
});
console.log("transcripts:", JSON.stringify(snap));
