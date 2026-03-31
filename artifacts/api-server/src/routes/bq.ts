import { Router, type IRouter } from "express";
import { z } from "zod";
import { getBigQueryClient, getGCSClient, getGcpProjectId } from "../services/gcp-clients";

const router: IRouter = Router();

function getBqTables() {
  const projectId = getGcpProjectId();
  return {
    staging: `${projectId}.incontact.staging_call_queue`,
    recordings: `${projectId}.incontact.call_recordings`,
    bucket: "incontact-audio",
  };
}

router.get("/bq/staging-summary", async (_req, res) => {
  try {
    const bq = getBigQueryClient();
    const { staging } = getBqTables();
    const [rows] = await bq.query({
      query: `SELECT status, COUNT(*) as count FROM \`${staging}\` GROUP BY status ORDER BY status`,
    });
    const summary: Record<string, number> = { pending: 0, processing: 0, downloaded: 0, failed: 0 };
    rows.forEach((r: any) => { summary[r.status] = Number(r.count); });
    const total = Object.values(summary).reduce((a, b) => a + b, 0);
    res.json({ ...summary, total });
  } catch (err: any) {
    console.error("[bq/staging-summary]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/bq/staging-queue", async (_req, res) => {
  try {
    const bq = getBigQueryClient();
    const { staging } = getBqTables();
    const [rows] = await bq.query({
      query: `SELECT id, call_id, status, error_message, batch_id, 
              FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', created_at) as created_at, 
              FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', processed_at) as processed_at
              FROM \`${staging}\` ORDER BY created_at DESC LIMIT 200`,
    });
    res.json(rows);
  } catch (err: any) {
    console.error("[bq/staging-queue]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/bq/recordings", async (_req, res) => {
  try {
    const bq = getBigQueryClient();
    const { recordings } = getBqTables();
    const [rows] = await bq.query({
      query: `SELECT id, contact_id, acd_contact_id, agent_id, agent_name, 
              FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', start_date) as start_date,
              FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', end_date) as end_date,
              duration_seconds, media_type, direction, file_name, gcs_uri, file_size_bytes,
              call_tags, FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', ingestion_timestamp) as ingestion_timestamp
              FROM \`${recordings}\` ORDER BY ingestion_timestamp DESC LIMIT 200`,
    });
    res.json(rows);
  } catch (err: any) {
    console.error("[bq/recordings]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/bq/staging-add", async (req, res) => {
  try {
    const schema = z.object({
      callIds: z.array(z.string().min(1)).min(1).max(500),
      batchId: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const bq = getBigQueryClient();
    const { staging } = getBqTables();
    const batchId = parsed.data.batchId || `batch-${Date.now()}`;
    const callIdRegex = /^\d{6,20}$/;
    const validIds = parsed.data.callIds.filter((id) => callIdRegex.test(id));
    if (validIds.length === 0) return res.status(400).json({ error: "No valid call IDs (must be 6-20 digits)" });

    for (const callId of validIds) {
      await bq.query({
        query: `INSERT INTO \`${staging}\` (id, call_id, status, created_at, batch_id) VALUES (GENERATE_UUID(), @callId, 'pending', CURRENT_TIMESTAMP(), @batchId)`,
        params: { callId, batchId },
      });
    }

    res.json({ added: validIds.length, batchId });
  } catch (err: any) {
    console.error("[bq/staging-add]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/bq/staging-reset-failed", async (_req, res) => {
  try {
    const bq = getBigQueryClient();
    const { staging } = getBqTables();
    await bq.query({
      query: `UPDATE \`${staging}\` SET status = 'pending', error_message = NULL, processed_at = NULL WHERE status = 'failed'`,
    });
    res.json({ message: "Failed rows reset to pending" });
  } catch (err: any) {
    console.error("[bq/staging-reset-failed]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/bq/staging-clear", async (_req, res) => {
  try {
    const bq = getBigQueryClient();
    const { staging, recordings } = getBqTables();
    await bq.query({ query: `DELETE FROM \`${staging}\` WHERE true` });
    await bq.query({ query: `DELETE FROM \`${recordings}\` WHERE true` });
    res.json({ message: "Tables cleared" });
  } catch (err: any) {
    console.error("[bq/staging-clear]", err.message);
    res.status(500).json({ error: err.message });
  }
});

async function triggerInContactCloudRunJob(jobName: string) {
  const projectId = getGcpProjectId();
  const { google } = await import("googleapis");
  const gcpKey = process.env.GCP_SERVICE_ACCOUNT_KEY;
  const authOptions: any = {
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  };
  if (gcpKey) {
    authOptions.credentials = JSON.parse(gcpKey);
  }
  const auth = new google.auth.GoogleAuth(authOptions);
  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();

  const runRes = await fetch(
    `https://run.googleapis.com/v2/projects/${projectId}/locations/us-central1/jobs/${jobName}:run`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken.token}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!runRes.ok) {
    const errText = await runRes.text();
    throw new Error(`Cloud Run API returned ${runRes.status}: ${errText}`);
  }

  const data = await runRes.json();
  return { message: "Job started", executionName: (data as any).metadata?.name || (data as any).name };
}

router.post("/bq/run-job", async (_req, res) => {
  try {
    const result = await triggerInContactCloudRunJob("incontact-call-processor");
    res.json(result);
  } catch (err: any) {
    console.error("[bq/run-job]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/bq/run-loader", async (_req, res) => {
  try {
    const result = await triggerInContactCloudRunJob("incontact-call-loader");
    res.json(result);
  } catch (err: any) {
    console.error("[bq/run-loader]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/bq/call-list-status", async (_req, res) => {
  try {
    const { bucket } = getBqTables();
    const gcsClient = getGCSClient();
    const file = gcsClient.bucket(bucket).file("call_list/call_list.txt");
    const [exists] = await file.exists();
    if (!exists) {
      return res.json({ exists: false, lineCount: 0 });
    }
    const [contents] = await file.download();
    const lines = contents.toString("utf-8").split(/\r?\n/).map(l => l.trim()).filter(l => /^\d{6,20}$/.test(l));
    res.json({ exists: true, lineCount: lines.length });
  } catch (err: any) {
    console.error("[bq/call-list-status]", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
