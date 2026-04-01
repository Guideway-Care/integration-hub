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

router.get("/bq/staging-summary", async (req, res) => {
  try {
    const bq = getBigQueryClient("US");
    const { staging } = getBqTables();
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    let whereClause = "";
    const params: Record<string, string> = {};
    if (startDate) {
      whereClause += " WHERE created_at >= TIMESTAMP(@startDate)";
      params.startDate = startDate;
    }
    if (endDate) {
      whereClause += whereClause ? " AND " : " WHERE ";
      whereClause += "created_at < TIMESTAMP_ADD(TIMESTAMP(@endDate), INTERVAL 1 DAY)";
      params.endDate = endDate;
    }
    const [rows] = await bq.query({
      query: `SELECT status, COUNT(*) as count FROM \`${staging}\`${whereClause} GROUP BY status ORDER BY status`,
      params,
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
    const bq = getBigQueryClient("US");
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
    const bq = getBigQueryClient("US");
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
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }

    const bq = getBigQueryClient("US");
    const { staging } = getBqTables();
    const batchId = parsed.data.batchId || `batch-${Date.now()}`;
    const callIdRegex = /^\d{6,20}$/;
    const validIds = parsed.data.callIds.filter((id) => callIdRegex.test(id));
    if (validIds.length === 0) {
      res.status(400).json({ error: "No valid call IDs (must be 6-20 digits)" });
      return;
    }

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
    const bq = getBigQueryClient("US");
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
    const bq = getBigQueryClient("US");
    const { staging, recordings } = getBqTables();
    await bq.query({ query: `DELETE FROM \`${staging}\` WHERE true` });
    await bq.query({ query: `DELETE FROM \`${recordings}\` WHERE true` });
    res.json({ message: "Tables cleared" });
  } catch (err: any) {
    console.error("[bq/staging-clear]", err.message);
    res.status(500).json({ error: err.message });
  }
});

async function getAccessToken(): Promise<string> {
  if (process.env.NODE_ENV === "development") {
    const { google } = await import("googleapis");
    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    return token.token || "";
  }
  const resp = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } },
  );
  if (!resp.ok) throw new Error(`Failed to get access token: ${resp.status}`);
  const data = await resp.json() as { access_token: string };
  return data.access_token;
}

async function triggerInContactCloudRunJob(jobName: string) {
  const projectId = getGcpProjectId();
  const token = await getAccessToken();

  const runRes = await fetch(
    `https://run.googleapis.com/v2/projects/${projectId}/locations/us-central1/jobs/${jobName}:run`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
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

let transformJob: {
  status: "idle" | "running" | "completed" | "failed";
  step: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  durationFormatted?: string;
  rowsProcessed?: string | null;
  error?: string;
} = { status: "idle", step: "" };

async function runTransformPipeline() {
  const bqRegional = getBigQueryClient("us-central1");
  const bqUS = getBigQueryClient("US");
  const gcs = getGCSClient();
  const projectId = getGcpProjectId();
  const gcsBucket = "incontact-audio";
  const gcsPrefix = "transform-staging";
  const startTime = Date.now();

  try {
    transformJob.step = "Step 1/4: Extracting contacts from raw data...";
    console.log("[transform] Step 1: Extract from raw.api_payload → raw.calls_extracted (us-central1)");
    const step1Query = `
      CREATE OR REPLACE TABLE \`${projectId}.raw.calls_extracted\` AS
      WITH extracted AS (
        SELECT
          CAST(JSON_VALUE(contact, '$.contactId') AS INT64) AS contact_id,
          CAST(JSON_VALUE(contact, '$.masterContactId') AS INT64) AS master_contact_id,
          CAST(JSON_VALUE(contact, '$.contactStartDate') AS TIMESTAMP) AS contact_start_date,
          CAST(JSON_VALUE(contact, '$.agentStartDate') AS TIMESTAMP) AS agent_start_date,
          CAST(JSON_VALUE(contact, '$.lastUpdateTime') AS TIMESTAMP) AS last_update_time,
          CAST(JSON_VALUE(contact, '$.dateACWWarehoused') AS TIMESTAMP) AS date_acw_warehoused,
          CAST(JSON_VALUE(contact, '$.dateContactWarehoused') AS TIMESTAMP) AS date_contact_warehoused,
          CAST(JSON_VALUE(contact, '$.analyticsProcessedDate') AS TIMESTAMP) AS analytics_processed_date,
          CAST(JSON_VALUE(contact, '$.agentId') AS INT64) AS agent_id,
          JSON_VALUE(contact, '$.firstName') AS first_name,
          JSON_VALUE(contact, '$.lastName') AS last_name,
          CAST(JSON_VALUE(contact, '$.campaignId') AS INT64) AS campaign_id,
          JSON_VALUE(contact, '$.campaignName') AS campaign_name,
          CAST(JSON_VALUE(contact, '$.skillId') AS INT64) AS skill_id,
          JSON_VALUE(contact, '$.skillName') AS skill_name,
          CAST(JSON_VALUE(contact, '$.teamId') AS INT64) AS team_id,
          JSON_VALUE(contact, '$.teamName') AS team_name,
          CAST(JSON_VALUE(contact, '$.mediaTypeId') AS INT64) AS media_type_id,
          JSON_VALUE(contact, '$.mediaTypeName') AS media_type_name,
          JSON_VALUE(contact, '$.mediaSubTypeId') AS media_sub_type_id,
          JSON_VALUE(contact, '$.mediaSubTypeName') AS media_sub_type_name,
          CAST(JSON_VALUE(contact, '$.pointOfContactId') AS INT64) AS point_of_contact_id,
          JSON_VALUE(contact, '$.pointOfContactName') AS point_of_contact_name,
          JSON_VALUE(contact, '$.fromAddress') AS from_address,
          JSON_VALUE(contact, '$.toAddress') AS to_address,
          CAST(JSON_VALUE(contact, '$.stateId') AS INT64) AS state_id,
          JSON_VALUE(contact, '$.stateName') AS state_name,
          JSON_VALUE(contact, '$.contactStateCategory') AS contact_state_category,
          JSON_VALUE(contact, '$.digitalContactStateId') AS digital_contact_state_id,
          JSON_VALUE(contact, '$.digitalContactStateName') AS digital_contact_state_name,
          JSON_VALUE(contact, '$.endReason') AS end_reason,
          JSON_VALUE(contact, '$.dispositionNotes') AS disposition_notes,
          CAST(JSON_VALUE(contact, '$.primaryDispositionId') AS INT64) AS primary_disposition_id,
          CAST(JSON_VALUE(contact, '$.secondaryDispositionId') AS INT64) AS secondary_disposition_id,
          CAST(JSON_VALUE(contact, '$.abandonSeconds') AS FLOAT64) AS abandon_seconds,
          CAST(JSON_VALUE(contact, '$.abandoned') AS BOOL) AS abandoned,
          CAST(JSON_VALUE(contact, '$.acwSeconds') AS FLOAT64) AS acw_seconds,
          CAST(JSON_VALUE(contact, '$.agentSeconds') AS FLOAT64) AS agent_seconds,
          CAST(JSON_VALUE(contact, '$.callbackTime') AS FLOAT64) AS callback_time,
          CAST(JSON_VALUE(contact, '$.conferenceSeconds') AS FLOAT64) AS conference_seconds,
          CAST(JSON_VALUE(contact, '$.holdCount') AS INT64) AS hold_count,
          CAST(JSON_VALUE(contact, '$.holdSeconds') AS FLOAT64) AS hold_seconds,
          CAST(JSON_VALUE(contact, '$.inQueueSeconds') AS FLOAT64) AS in_queue_seconds,
          CAST(JSON_VALUE(contact, '$.preQueueSeconds') AS FLOAT64) AS pre_queue_seconds,
          CAST(JSON_VALUE(contact, '$.postQueueSeconds') AS FLOAT64) AS post_queue_seconds,
          CAST(JSON_VALUE(contact, '$.releaseSeconds') AS FLOAT64) AS release_seconds,
          CAST(JSON_VALUE(contact, '$.totalDurationSeconds') AS FLOAT64) AS total_duration_seconds,
          CAST(JSON_VALUE(contact, '$.routingTime') AS FLOAT64) AS routing_time,
          CAST(JSON_VALUE(contact, '$.routingAttribute') AS INT64) AS routing_attribute,
          CAST(JSON_VALUE(contact, '$.highProficiency') AS INT64) AS high_proficiency,
          CAST(JSON_VALUE(contact, '$.lowProficiency') AS INT64) AS low_proficiency,
          CAST(JSON_VALUE(contact, '$.serviceLevelFlag') AS INT64) AS service_level_flag,
          CAST(JSON_VALUE(contact, '$.targetAgentId') AS INT64) AS target_agent_id,
          CAST(JSON_VALUE(contact, '$.transferIndicatorId') AS INT64) AS transfer_indicator_id,
          JSON_VALUE(contact, '$.transferIndicatorName') AS transfer_indicator_name,
          CAST(JSON_VALUE(contact, '$.isActive') AS BOOL) AS is_active,
          CAST(JSON_VALUE(contact, '$.isAnalyticsProcessed') AS BOOL) AS is_analytics_processed,
          CAST(JSON_VALUE(contact, '$.isLogged') AS BOOL) AS is_logged,
          CAST(JSON_VALUE(contact, '$.isOutbound') AS BOOL) AS is_outbound,
          CAST(JSON_VALUE(contact, '$.isRefused') AS BOOL) AS is_refused,
          CAST(JSON_VALUE(contact, '$.isShortAbandon') AS BOOL) AS is_short_abandon,
          CAST(JSON_VALUE(contact, '$.isTakeover') AS BOOL) AS is_takeover,
          CAST(JSON_VALUE(contact, '$.isWarehoused') AS BOOL) AS is_warehoused,
          JSON_VALUE(contact, '$.refuseReason') AS refuse_reason,
          JSON_VALUE(contact, '$.refuseTime') AS refuse_time,
          JSON_VALUE(contact, '$.fileName') AS file_name,
          p.run_id,
          p.ingested_ts,
          ROW_NUMBER() OVER (PARTITION BY CAST(JSON_VALUE(contact, '$.contactId') AS INT64) ORDER BY p.ingested_ts DESC) AS rn
        FROM \`${projectId}.raw.api_payload\` p,
        UNNEST(
          CASE
            WHEN JSON_QUERY_ARRAY(p.response_body_json, '$.contacts') IS NOT NULL
              THEN JSON_QUERY_ARRAY(p.response_body_json, '$.contacts')
            ELSE JSON_QUERY_ARRAY(p.response_body_json, '$.completedContacts')
          END
        ) AS contact
        WHERE (p.page_status = 'SUCCESS' OR p.http_status_code = 200)
      )
      SELECT * EXCEPT(rn) FROM extracted WHERE rn = 1
    `;
    const [job1] = await bqRegional.createQueryJob({ query: step1Query });
    await job1.getQueryResults();
    console.log("[transform] Step 1 complete");

    transformJob.step = "Step 2/4: Exporting to cloud storage...";
    console.log("[transform] Step 2: Cleaning old staging files then exporting");
    try {
      const [oldFiles] = await gcs.bucket(gcsBucket).getFiles({ prefix: `${gcsPrefix}/` });
      if (oldFiles.length > 0) {
        await Promise.all(oldFiles.map((f: any) => f.delete()));
        console.log(`[transform] Cleaned ${oldFiles.length} old staging files`);
      }
    } catch (cleanErr: any) {
      console.warn("[transform] Pre-cleanup warning:", cleanErr.message);
    }

    const dataset = bqRegional.dataset("raw");
    const table = dataset.table("calls_extracted");
    const [exportJob] = await table.extract(
      gcs.bucket(gcsBucket).file(`${gcsPrefix}/data_*.avro`),
      { format: "AVRO", gzip: false }
    );
    console.log("[transform] Step 2 complete, export status:", exportJob.status?.state);

    transformJob.step = "Step 3/4: Loading into target region...";
    console.log("[transform] Step 3: Load GCS → incontact.calls_staging (US)");
    const incontactDataset = bqUS.dataset("incontact");
    const stagingTable = incontactDataset.table("calls_staging");
    const [loadJob] = await stagingTable.load(
      gcs.bucket(gcsBucket).file(`${gcsPrefix}/data_*.avro`),
      {
        sourceFormat: "AVRO",
        writeDisposition: "WRITE_TRUNCATE",
        useAvroLogicalTypes: true,
      }
    );
    console.log("[transform] Step 3 complete, load status:", loadJob.status?.state);

    transformJob.step = "Step 4/4: Joining with dispositions...";
    console.log("[transform] Step 4: JOIN with dispositions → incontact.calls (US)");
    const step4Query = `
      CREATE OR REPLACE TABLE \`${projectId}.incontact.calls\` AS
      SELECT
        s.*,
        pd.disposition_name AS primary_disposition_name,
        sd.disposition_name AS secondary_disposition_name
      FROM \`${projectId}.incontact.calls_staging\` s
      LEFT JOIN \`${projectId}.incontact.dispositions\` pd
        ON s.primary_disposition_id = pd.disposition_id
      LEFT JOIN \`${projectId}.incontact.dispositions\` sd
        ON s.secondary_disposition_id = sd.disposition_id
    `;
    const [job4] = await bqUS.createQueryJob({ query: step4Query });
    await job4.getQueryResults();
    const durationMs = Date.now() - startTime;
    console.log("[transform] Step 4 complete");

    const meta4 = await job4.getMetadata();
    const stats = meta4[0]?.statistics;
    const totalRows = stats?.query?.numDmlAffectedRows || stats?.numRowsAffected || null;

    console.log("[transform] Cleanup: removing GCS staging files");
    try {
      const [files] = await gcs.bucket(gcsBucket).getFiles({ prefix: `${gcsPrefix}/` });
      await Promise.all(files.map((f: any) => f.delete()));
    } catch (cleanupErr: any) {
      console.warn("[transform] Cleanup warning:", cleanupErr.message);
    }

    transformJob = {
      status: "completed",
      step: "Done",
      startedAt: transformJob.startedAt,
      completedAt: new Date().toISOString(),
      durationMs,
      durationFormatted: durationMs >= 60000
        ? `${Math.floor(durationMs / 60000)}m ${Math.round((durationMs % 60000) / 1000)}s`
        : `${Math.round(durationMs / 1000)}s`,
      rowsProcessed: totalRows,
    };
    console.log("[transform] Pipeline complete:", transformJob.durationFormatted);
  } catch (err: any) {
    console.error("[transform] Pipeline failed:", err.message);
    transformJob = {
      status: "failed",
      step: transformJob.step,
      startedAt: transformJob.startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      error: err.message,
    };
  }
}

router.post("/bq/transform-contacts", async (_req, res) => {
  if (transformJob.status === "running") {
    res.status(409).json({ error: "Transform is already running", step: transformJob.step });
    return;
  }
  transformJob = { status: "running", step: "Starting...", startedAt: new Date().toISOString() };
  runTransformPipeline();
  res.json({ message: "Transform started", status: "running" });
});

router.get("/bq/transform-job-status", async (_req, res) => {
  res.json(transformJob);
});

router.get("/bq/transform-status", async (_req, res) => {
  try {
    const projectId = getGcpProjectId();
    const bqUS = getBigQueryClient("US");
    const bqRegional = getBigQueryClient("us-central1");

    const [callsRows] = await bqUS.query({
      query: `SELECT COUNT(*) as count FROM \`${projectId}.incontact.calls\``,
    });
    const callsCount = Number(callsRows[0]?.count || 0);

    const [rawRows] = await bqRegional.query({
      query: `SELECT COUNT(*) as count FROM \`${projectId}.raw.api_payload\` WHERE (page_status = 'SUCCESS' OR http_status_code = 200)`,
    });
    const rawPagesCount = Number(rawRows[0]?.count || 0);

    const [latestRow] = await bqRegional.query({
      query: `SELECT MAX(ingested_ts) as last_ingested FROM \`${projectId}.raw.api_payload\` WHERE (page_status = 'SUCCESS' OR http_status_code = 200)`,
    });
    const lastIngested = latestRow[0]?.last_ingested?.value || null;

    const [latestCallRow] = await bqUS.query({
      query: `SELECT MAX(contact_start_date) as latest_contact FROM \`${projectId}.incontact.calls\``,
    });
    const latestContact = latestCallRow[0]?.latest_contact?.value || null;

    const [statusRows] = await bqRegional.query({
      query: `SELECT page_status, COUNT(*) as cnt FROM \`${projectId}.raw.api_payload\` GROUP BY page_status ORDER BY cnt DESC`,
    });
    const pageStatuses = statusRows.map((r: any) => ({ status: r.page_status, count: Number(r.cnt) }));

    const [allRawCount] = await bqRegional.query({
      query: `SELECT COUNT(*) as count FROM \`${projectId}.raw.api_payload\``,
    });
    const totalRawPages = Number(allRawCount[0]?.count || 0);

    res.json({
      callsTableCount: callsCount,
      rawPagesCount,
      totalRawPages,
      pageStatuses,
      lastIngested,
      latestContact,
    });
  } catch (err: any) {
    console.error("[bq/transform-status]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/bq/run-job", async (_req, res) => {
  try {
    const result = await triggerInContactCloudRunJob("incontact-call-processor");
    res.json(result);
  } catch (err: any) {
    console.error("[bq/run-job]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/bq/queue-recordings", async (_req, res) => {
  try {
    const projectId = getGcpProjectId();
    const bq = getBigQueryClient("US");
    const { bucket } = getBqTables();
    const gcs = getGCSClient();

    const query = `
      SELECT CAST(c.contact_id AS STRING) AS contact_id
      FROM \`${projectId}.incontact.calls\` c
      LEFT JOIN \`${projectId}.incontact.call_recordings\` r
        ON CAST(c.contact_id AS STRING) = CAST(r.acd_contact_id AS STRING)
      WHERE c.campaign_name = 'United Regional Health'
        AND c.primary_disposition_name LIKE 'Reached Patient%'
        AND r.acd_contact_id IS NULL
      ORDER BY c.contact_start_date DESC
    `;

    console.log("[queue-recordings] Running query to find missing recordings...");
    const [rows] = await bq.query({ query });
    const contactIds = rows.map((r: any) => r.contact_id).filter(Boolean);
    console.log(`[queue-recordings] Found ${contactIds.length} contacts missing recordings`);

    if (contactIds.length === 0) {
      res.json({ queued: 0, message: "No new recordings to queue" });
      return;
    }

    const fileContent = contactIds.join("\n") + "\n";
    const file = gcs.bucket(bucket).file("call_list/call_list.txt");
    await file.save(fileContent, { contentType: "text/plain" });
    console.log(`[queue-recordings] Wrote ${contactIds.length} contact IDs to gs://${bucket}/call_list/call_list.txt`);

    res.json({ queued: contactIds.length });
  } catch (err: any) {
    console.error("[bq/queue-recordings]", err.message);
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
      res.json({ exists: false, lineCount: 0 });
      return;
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
