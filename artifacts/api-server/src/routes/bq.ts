import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { recordingFilterRuleTable } from "@workspace/db/schema";
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

export type PendingRecordingsRule = {
  campaignName: string;
  dispositionPattern: string;
};

export type PendingRecordingsQueryOptions = {
  rules: PendingRecordingsRule[];
  dateFrom?: string;
  dateTo?: string;
};

const DEFAULT_PENDING_RECORDINGS_FLOOR = "2026-01-15";

export function buildPendingRecordingsQuery(opts: PendingRecordingsQueryOptions): {
  query: string;
  params: Record<string, unknown>;
  types: Record<string, unknown>;
} {
  const projectId = getGcpProjectId();
  const dateFrom = opts.dateFrom || DEFAULT_PENDING_RECORDINGS_FLOOR;
  const query = `
    SELECT CAST(c.contact_id AS STRING) AS contact_id
    FROM \`${projectId}.incontact.calls\` c
    LEFT JOIN \`${projectId}.incontact.call_recordings\` r
      ON CAST(c.contact_id AS STRING) = CAST(r.acd_contact_id AS STRING)
    WHERE EXISTS (
        SELECT 1 FROM UNNEST(@rules) AS rule
        WHERE c.campaign_name = rule.campaign_name
          AND c.primary_disposition_name LIKE rule.disposition_pattern
      )
      AND r.acd_contact_id IS NULL
      AND DATE(c.contact_start_date) >= @date_from
      AND (@date_to IS NULL OR DATE(c.contact_start_date) <= @date_to)
    ORDER BY c.contact_start_date ASC
  `;
  return {
    query,
    params: {
      rules: opts.rules.map((r) => ({
        campaign_name: r.campaignName,
        disposition_pattern: r.dispositionPattern,
      })),
      date_from: dateFrom,
      date_to: opts.dateTo ?? null,
    },
    types: {
      rules: [{ campaign_name: "STRING", disposition_pattern: "STRING" }],
      date_from: "DATE",
      date_to: "DATE",
    },
  };
}

export async function findPendingRecordingContactIds(
  opts: PendingRecordingsQueryOptions,
): Promise<string[]> {
  if (opts.rules.length === 0) return [];
  const bq = getBigQueryClient("US");
  const { query, params, types } = buildPendingRecordingsQuery(opts);
  const [rows] = (await bq.query({ query, params, types } as any)) as [Array<{ contact_id: string }>];
  return rows.map((r) => r.contact_id).filter(Boolean);
}

export async function writePendingRecordingsToGcs(
  contactIds: string[],
  gcsPath: string,
): Promise<{ bucket: string; path: string; count: number }> {
  const { bucket } = getBqTables();
  const gcs = getGCSClient();
  const fileContent = contactIds.join("\n") + (contactIds.length > 0 ? "\n" : "");
  const file = gcs.bucket(bucket).file(gcsPath);
  await file.save(fileContent, { contentType: "text/plain" });
  return { bucket, path: gcsPath, count: contactIds.length };
}

export const DEFAULT_DAILY_RULES: PendingRecordingsRule[] = [
  { campaignName: "United Regional Health", dispositionPattern: "Reached Patient%" },
  { campaignName: "Dignity", dispositionPattern: "Reached Patient%" },
];

/**
 * Load active filter rules from the DB. Falls back to DEFAULT_DAILY_RULES when
 * the table is empty so that a freshly-deployed environment still produces the
 * historical behavior.
 */
export async function loadActiveDailyRules(): Promise<{ rules: PendingRecordingsRule[]; usedFallback: boolean }> {
  const rows = await db
    .select()
    .from(recordingFilterRuleTable)
    .where(eq(recordingFilterRuleTable.isActive, true));
  if (rows.length === 0) {
    return { rules: DEFAULT_DAILY_RULES, usedFallback: true };
  }
  return {
    rules: rows.map((r) => ({ campaignName: r.campaignName, dispositionPattern: r.dispositionPattern })),
    usedFallback: false,
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

router.get("/bq/recordings", async (req, res) => {
  try {
    const bq = getBigQueryClient("US");
    const { recordings } = getBqTables();
    const search = (req.query.search as string) || "";
    const limit = Math.min(parseInt(req.query.limit as string) || 500, 2000);
    const offset = parseInt(req.query.offset as string) || 0;

    let whereClause = "";
    const params: Record<string, string> = {};
    if (search.trim()) {
      whereClause = `WHERE LOWER(CAST(acd_contact_id AS STRING)) LIKE LOWER(@search)
        OR LOWER(COALESCE(agent_name, '')) LIKE LOWER(@search)
        OR LOWER(COALESCE(file_name, '')) LIKE LOWER(@search)
        OR LOWER(CAST(contact_id AS STRING)) LIKE LOWER(@search)`;
      params.search = `%${search.trim()}%`;
    }

    const countQuery = `SELECT COUNT(*) as total FROM \`${recordings}\` ${whereClause}`;
    const [countRows] = await bq.query({ query: countQuery, params });

    const dataQuery = `SELECT id, contact_id, acd_contact_id, agent_id, agent_name, 
              FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', start_date) as start_date,
              FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', end_date) as end_date,
              duration_seconds, media_type, direction, file_name, gcs_uri, file_size_bytes,
              call_tags, FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', ingestion_timestamp) as ingestion_timestamp
              FROM \`${recordings}\` ${whereClause} ORDER BY start_date DESC LIMIT @limit OFFSET @offset`;
    const [rows] = await bq.query({
      query: dataQuery,
      params: { ...params, limit, offset },
      types: { limit: "INT64", offset: "INT64" },
    });

    res.json({ rows, total: countRows[0]?.total ?? 0, limit, offset });
  } catch (err: any) {
    console.error("[bq/recordings]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/bq/recording-stream/:contactId", async (req, res) => {
  try {
    const { contactId } = req.params;
    const gcs = getGCSClient();
    const bucket = gcs.bucket("incontact-audio");
    const file = bucket.file(`${contactId}.mp4`);

    const [exists] = await file.exists();
    if (!exists) {
      res.status(404).json({ error: `Recording not found: ${contactId}.mp4` });
      return;
    }

    const [metadata] = await file.getMetadata();
    res.set("Content-Type", "audio/mp4");
    res.set("Content-Length", String(metadata.size));
    res.set("Content-Disposition", `inline; filename="${contactId}.mp4"`);
    res.set("Accept-Ranges", "bytes");

    const range = req.headers.range;
    if (range && metadata.size) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : Number(metadata.size) - 1;
      res.status(206);
      res.set("Content-Range", `bytes ${start}-${end}/${metadata.size}`);
      res.set("Content-Length", String(end - start + 1));
      file.createReadStream({ start, end }).pipe(res);
    } else {
      file.createReadStream().pipe(res);
    }
  } catch (err: any) {
    console.error("[bq/recording-stream]", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
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

export async function triggerLoaderJob(callListPath?: string) {
  const env = callListPath ? { CALL_LIST_PATH: callListPath } : undefined;
  return triggerInContactCloudRunJob("incontact-call-loader", env);
}

export async function triggerProcessorJob() {
  return triggerInContactCloudRunJob("incontact-call-processor");
}

export async function awaitExecution(executionName: string, timeoutMs?: number) {
  return waitForExecution(executionName, timeoutMs);
}

async function triggerInContactCloudRunJob(
  jobName: string,
  envOverrides?: Record<string, string>,
) {
  const projectId = getGcpProjectId();
  const token = await getAccessToken();

  const body =
    envOverrides && Object.keys(envOverrides).length > 0
      ? {
          overrides: {
            containerOverrides: [
              {
                env: Object.entries(envOverrides).map(([name, value]) => ({ name, value })),
              },
            ],
          },
        }
      : undefined;

  const runRes = await fetch(
    `https://run.googleapis.com/v2/projects/${projectId}/locations/us-central1/jobs/${jobName}:run`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    }
  );

  if (!runRes.ok) {
    const errText = await runRes.text();
    throw new Error(`Cloud Run API returned ${runRes.status}: ${errText}`);
  }

  const data = await runRes.json();
  const executionName = (data as any).metadata?.name || (data as any).name;
  return { message: "Job started", executionName };
}

async function waitForExecution(executionName: string, timeoutMs = 600000, pollIntervalMs = 5000): Promise<{ done: boolean; succeeded: boolean; error?: string }> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const token = await getAccessToken();
    const res = await fetch(
      `https://run.googleapis.com/v2/${executionName}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to poll execution ${executionName}: ${res.status} ${errText}`);
    }

    const exec = await res.json() as any;
    const completionTime = exec.completionTime;
    if (completionTime) {
      const conditions = exec.conditions || [];
      const succeeded = conditions.some((c: any) => c.type === "Completed" && c.state === "CONDITION_SUCCEEDED");
      const failReason = conditions.find((c: any) => c.state === "CONDITION_FAILED");
      return {
        done: true,
        succeeded,
        error: failReason ? failReason.message || "Execution failed" : undefined,
      };
    }

    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  return { done: false, succeeded: false, error: "Timed out waiting for execution to complete" };
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

export function getContactsTransformJob() {
  return transformJob;
}

export function startContactsTransformPipeline(): boolean {
  if (transformJob.status === "running") return false;
  transformJob = { status: "running", step: "Starting...", startedAt: new Date().toISOString() };
  runTransformPipeline();
  return true;
}

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
          AND p.endpoint_id IN ('nice-cxone-contacts', 'incontact-completed-contacts')
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
      query: `SELECT COUNT(*) as count FROM \`${projectId}.raw.api_payload\` WHERE (page_status = 'SUCCESS' OR http_status_code = 200) AND endpoint_id IN ('nice-cxone-contacts', 'incontact-completed-contacts')`,
    });
    const rawPagesCount = Number(rawRows[0]?.count || 0);

    const [latestRow] = await bqRegional.query({
      query: `SELECT MAX(ingested_ts) as last_ingested FROM \`${projectId}.raw.api_payload\` WHERE (page_status = 'SUCCESS' OR http_status_code = 200) AND endpoint_id IN ('nice-cxone-contacts', 'incontact-completed-contacts')`,
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

let agentsTransformJob: {
  status: "idle" | "running" | "completed" | "failed";
  step: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  durationFormatted?: string;
  rowsProcessed?: string | null;
  error?: string;
} = { status: "idle", step: "" };

export function getAgentsTransformJob() {
  return agentsTransformJob;
}

export function startAgentsTransformPipeline() {
  if (agentsTransformJob.status === "running") return false;
  agentsTransformJob = { status: "running", step: "Starting...", startedAt: new Date().toISOString() };
  runAgentsTransformPipeline();
  return true;
}

async function runAgentsTransformPipeline() {
  const projectId = getGcpProjectId();
  const bqRegional = getBigQueryClient("us-central1");
  const bqUS = getBigQueryClient("US");
  const gcs = getGCSClient();
  const gcsBucket = "incontact-audio";
  const gcsPrefix = "agents-transform-staging";
  const startTime = Date.now();

  try {
    agentsTransformJob.step = "Step 1/3: Extracting agent performance from raw data...";
    console.log("[agents-transform] Step 1: Extract from raw.api_payload → raw.agents_extracted (us-central1)");
    const step1Query = `
      CREATE OR REPLACE TABLE \`${projectId}.raw.agents_extracted\` AS
      WITH extracted AS (
        SELECT
          CAST(JSON_VALUE(agent, '$.agentId') AS INT64) AS agent_id,
          CAST(JSON_VALUE(agent, '$.teamId') AS INT64) AS team_id,
          CAST(JSON_VALUE(agent, '$.agentOffered') AS INT64) AS agent_offered,
          CAST(JSON_VALUE(agent, '$.inboundHandled') AS INT64) AS inbound_handled,
          IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.inboundTime'), r'(\\d+)H') AS FLOAT64) * 3600, 0) + IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.inboundTime'), r'(\\d+)M') AS FLOAT64) * 60, 0) + IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.inboundTime'), r'([\\d.]+)S') AS FLOAT64), 0) AS inbound_time_seconds,
          IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.inboundTalkTime'), r'(\\d+)H') AS FLOAT64) * 3600, 0) + IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.inboundTalkTime'), r'(\\d+)M') AS FLOAT64) * 60, 0) + IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.inboundTalkTime'), r'([\\d.]+)S') AS FLOAT64), 0) AS inbound_talk_time_seconds,
          IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.inboundAvgTalkTime'), r'(\\d+)H') AS FLOAT64) * 3600, 0) + IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.inboundAvgTalkTime'), r'(\\d+)M') AS FLOAT64) * 60, 0) + IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.inboundAvgTalkTime'), r'([\\d.]+)S') AS FLOAT64), 0) AS inbound_avg_talk_time_seconds,
          CAST(JSON_VALUE(agent, '$.outboundHandled') AS INT64) AS outbound_handled,
          IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.outboundTime'), r'(\\d+)H') AS FLOAT64) * 3600, 0) + IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.outboundTime'), r'(\\d+)M') AS FLOAT64) * 60, 0) + IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.outboundTime'), r'([\\d.]+)S') AS FLOAT64), 0) AS outbound_time_seconds,
          IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.outboundTalkTime'), r'(\\d+)H') AS FLOAT64) * 3600, 0) + IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.outboundTalkTime'), r'(\\d+)M') AS FLOAT64) * 60, 0) + IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.outboundTalkTime'), r'([\\d.]+)S') AS FLOAT64), 0) AS outbound_talk_time_seconds,
          IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.outboundAvgTalkTime'), r'(\\d+)H') AS FLOAT64) * 3600, 0) + IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.outboundAvgTalkTime'), r'(\\d+)M') AS FLOAT64) * 60, 0) + IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.outboundAvgTalkTime'), r'([\\d.]+)S') AS FLOAT64), 0) AS outbound_avg_talk_time_seconds,
          CAST(JSON_VALUE(agent, '$.totalHandled') AS INT64) AS total_handled,
          IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.totalTalkTime'), r'(\\d+)H') AS FLOAT64) * 3600, 0) + IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.totalTalkTime'), r'(\\d+)M') AS FLOAT64) * 60, 0) + IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.totalTalkTime'), r'([\\d.]+)S') AS FLOAT64), 0) AS total_talk_time_seconds,
          IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.totalAvgTalkTime'), r'(\\d+)H') AS FLOAT64) * 3600, 0) + IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.totalAvgTalkTime'), r'(\\d+)M') AS FLOAT64) * 60, 0) + IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.totalAvgTalkTime'), r'([\\d.]+)S') AS FLOAT64), 0) AS total_avg_talk_time_seconds,
          IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.totalAvgHandleTime'), r'(\\d+)H') AS FLOAT64) * 3600, 0) + IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.totalAvgHandleTime'), r'(\\d+)M') AS FLOAT64) * 60, 0) + IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.totalAvgHandleTime'), r'([\\d.]+)S') AS FLOAT64), 0) AS total_avg_handle_time_seconds,
          IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.consultTime'), r'(\\d+)H') AS FLOAT64) * 3600, 0) + IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.consultTime'), r'(\\d+)M') AS FLOAT64) * 60, 0) + IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.consultTime'), r'([\\d.]+)S') AS FLOAT64), 0) AS consult_time_seconds,
          IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.availableTime'), r'(\\d+)H') AS FLOAT64) * 3600, 0) + IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.availableTime'), r'(\\d+)M') AS FLOAT64) * 60, 0) + IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.availableTime'), r'([\\d.]+)S') AS FLOAT64), 0) AS available_time_seconds,
          IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.unavailableTime'), r'(\\d+)H') AS FLOAT64) * 3600, 0) + IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.unavailableTime'), r'(\\d+)M') AS FLOAT64) * 60, 0) + IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.unavailableTime'), r'([\\d.]+)S') AS FLOAT64), 0) AS unavailable_time_seconds,
          IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.acwTime'), r'(\\d+)H') AS FLOAT64) * 3600, 0) + IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.acwTime'), r'(\\d+)M') AS FLOAT64) * 60, 0) + IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.acwTime'), r'([\\d.]+)S') AS FLOAT64), 0) AS acw_time_seconds,
          CAST(JSON_VALUE(agent, '$.refused') AS INT64) AS refused,
          CAST(JSON_VALUE(agent, '$.percentRefused') AS FLOAT64) AS percent_refused,
          IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.loginTime'), r'(\\d+)H') AS FLOAT64) * 3600, 0) + IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.loginTime'), r'(\\d+)M') AS FLOAT64) * 60, 0) + IFNULL(CAST(REGEXP_EXTRACT(JSON_VALUE(agent, '$.loginTime'), r'([\\d.]+)S') AS FLOAT64), 0) AS login_time_seconds,
          CAST(JSON_VALUE(agent, '$.workingRate') AS FLOAT64) AS working_rate,
          CAST(JSON_VALUE(agent, '$.occupancy') AS FLOAT64) AS occupancy,
          CAST(REPLACE(REGEXP_EXTRACT(p.request_url, 'startDate=([^&]+)'), '%3A', ':') AS TIMESTAMP) AS start_date,
          CAST(REPLACE(REGEXP_EXTRACT(p.request_url, 'endDate=([^&]+)'), '%3A', ':') AS TIMESTAMP) AS end_date,
          p.run_id,
          p.ingested_ts,
          ROW_NUMBER() OVER (
            PARTITION BY CAST(JSON_VALUE(agent, '$.agentId') AS INT64),
              REGEXP_EXTRACT(p.request_url, 'startDate=([^&]+)')
            ORDER BY p.ingested_ts DESC
          ) AS rn
        FROM \`${projectId}.raw.api_payload\` p,
        UNNEST(JSON_QUERY_ARRAY(p.response_body_json, '$.agentPerformance')) AS agent
        WHERE (p.page_status = 'SUCCESS' OR p.http_status_code = 200)
          AND p.endpoint_id = 'nice-cxone-agents-performance'
      )
      SELECT * EXCEPT(rn) FROM extracted WHERE rn = 1
    `;
    const [job1] = await bqRegional.createQueryJob({ query: step1Query });
    await job1.getQueryResults();
    console.log("[agents-transform] Step 1 complete");

    agentsTransformJob.step = "Step 2/3: Exporting to cloud storage...";
    console.log("[agents-transform] Step 2: Export to GCS then load into incontact.agent_activity (US)");
    try {
      const [oldFiles] = await gcs.bucket(gcsBucket).getFiles({ prefix: `${gcsPrefix}/` });
      if (oldFiles.length > 0) {
        await Promise.all(oldFiles.map((f: any) => f.delete()));
        console.log(`[agents-transform] Cleaned ${oldFiles.length} old staging files`);
      }
    } catch (cleanErr: any) {
      console.warn("[agents-transform] Pre-cleanup warning:", cleanErr.message);
    }

    const dataset = bqRegional.dataset("raw");
    const table = dataset.table("agents_extracted");
    const [exportJob] = await table.extract(
      gcs.bucket(gcsBucket).file(`${gcsPrefix}/data_*.avro`),
      { format: "AVRO", gzip: false }
    );
    console.log("[agents-transform] Export complete, status:", exportJob.status?.state);

    agentsTransformJob.step = "Step 3/4: Loading into staging table...";
    console.log("[agents-transform] Step 3: Load GCS → incontact.agent_activity_staging (US)");
    const incontactDataset = bqUS.dataset("incontact");
    const stagingTable = incontactDataset.table("agent_activity_staging");
    const [loadJob] = await stagingTable.load(
      gcs.bucket(gcsBucket).file(`${gcsPrefix}/data_*.avro`),
      {
        sourceFormat: "AVRO",
        writeDisposition: "WRITE_TRUNCATE",
        useAvroLogicalTypes: true,
        autodetect: true,
      }
    );
    const loadStatus = loadJob?.status?.state || "UNKNOWN";
    const totalRows = loadJob?.statistics?.load?.outputRows || null;
    console.log("[agents-transform] Step 3 complete, staging load status:", loadStatus, "rows:", totalRows);

    agentsTransformJob.step = "Step 4/4: Merging into final table (dedup by agent_id + start_date)...";
    console.log("[agents-transform] Step 4: MERGE staging → incontact.agent_activity");
    const createIfNotExistsQuery = `
      CREATE TABLE IF NOT EXISTS \`${projectId}.incontact.agent_activity\` AS
      SELECT * FROM \`${projectId}.incontact.agent_activity_staging\` WHERE FALSE
    `;
    const [createJob] = await bqUS.createQueryJob({ query: createIfNotExistsQuery });
    await createJob.getQueryResults();
    console.log("[agents-transform] Ensured agent_activity table exists");

    const mergeQuery = `
      MERGE \`${projectId}.incontact.agent_activity\` AS target
      USING \`${projectId}.incontact.agent_activity_staging\` AS source
      ON target.agent_id = source.agent_id AND target.start_date = source.start_date
      WHEN MATCHED THEN
        UPDATE SET
          team_id = source.team_id,
          agent_offered = source.agent_offered,
          inbound_handled = source.inbound_handled,
          inbound_time_seconds = source.inbound_time_seconds,
          inbound_talk_time_seconds = source.inbound_talk_time_seconds,
          inbound_avg_talk_time_seconds = source.inbound_avg_talk_time_seconds,
          outbound_handled = source.outbound_handled,
          outbound_time_seconds = source.outbound_time_seconds,
          outbound_talk_time_seconds = source.outbound_talk_time_seconds,
          outbound_avg_talk_time_seconds = source.outbound_avg_talk_time_seconds,
          total_handled = source.total_handled,
          total_talk_time_seconds = source.total_talk_time_seconds,
          total_avg_talk_time_seconds = source.total_avg_talk_time_seconds,
          total_avg_handle_time_seconds = source.total_avg_handle_time_seconds,
          consult_time_seconds = source.consult_time_seconds,
          available_time_seconds = source.available_time_seconds,
          unavailable_time_seconds = source.unavailable_time_seconds,
          acw_time_seconds = source.acw_time_seconds,
          refused = source.refused,
          percent_refused = source.percent_refused,
          login_time_seconds = source.login_time_seconds,
          working_rate = source.working_rate,
          occupancy = source.occupancy,
          end_date = source.end_date,
          run_id = source.run_id,
          ingested_ts = source.ingested_ts
      WHEN NOT MATCHED THEN
        INSERT ROW
    `;
    const [mergeJob] = await bqUS.createQueryJob({ query: mergeQuery });
    await mergeJob.getQueryResults();
    console.log("[agents-transform] Step 4 complete: MERGE done");

    try {
      await stagingTable.delete();
      console.log("[agents-transform] Cleaned up staging table");
    } catch (e: any) {
      console.warn("[agents-transform] Staging cleanup warning:", e.message);
    }

    const durationMs = Date.now() - startTime;

    console.log("[agents-transform] Cleanup: removing GCS staging files");
    try {
      const [files] = await gcs.bucket(gcsBucket).getFiles({ prefix: `${gcsPrefix}/` });
      await Promise.all(files.map((f: any) => f.delete()));
    } catch (cleanupErr: any) {
      console.warn("[agents-transform] Cleanup warning:", cleanupErr.message);
    }

    agentsTransformJob = {
      status: "completed",
      step: "Done",
      startedAt: agentsTransformJob.startedAt,
      completedAt: new Date().toISOString(),
      durationMs,
      durationFormatted: durationMs >= 60000
        ? `${Math.floor(durationMs / 60000)}m ${Math.round((durationMs % 60000) / 1000)}s`
        : `${Math.round(durationMs / 1000)}s`,
      rowsProcessed: totalRows,
    };
    console.log("[agents-transform] Pipeline complete:", agentsTransformJob.durationFormatted, "rows:", totalRows);
  } catch (err: any) {
    console.error("[agents-transform] Pipeline failed:", err.message);
    agentsTransformJob = {
      status: "failed",
      step: agentsTransformJob.step,
      startedAt: agentsTransformJob.startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      error: err.message,
    };
  }
}

router.post("/bq/transform-agents", async (_req, res) => {
  if (agentsTransformJob.status === "running") {
    res.status(409).json({ error: "Agents transform is already running", step: agentsTransformJob.step });
    return;
  }
  agentsTransformJob = { status: "running", step: "Starting...", startedAt: new Date().toISOString() };
  runAgentsTransformPipeline();
  res.json({ message: "Agents transform started", status: "running" });
});

router.get("/bq/transform-agents-job-status", async (_req, res) => {
  res.json(agentsTransformJob);
});

router.get("/bq/transform-agents-status", async (_req, res) => {
  try {
    const projectId = getGcpProjectId();
    const bqUS = getBigQueryClient("US");
    const bqRegional = getBigQueryClient("us-central1");

    const [activityRows] = await bqUS.query({
      query: `SELECT COUNT(*) as count FROM \`${projectId}.incontact.agent_activity\``,
    }).catch(() => [[{ count: 0 }]]);
    const activityCount = Number(activityRows[0]?.count || 0);

    const [rawRows] = await bqRegional.query({
      query: `SELECT COUNT(*) as count FROM \`${projectId}.raw.api_payload\` WHERE (page_status = 'SUCCESS' OR http_status_code = 200) AND endpoint_id = 'nice-cxone-agents-performance'`,
    });
    const rawPagesCount = Number(rawRows[0]?.count || 0);

    const [latestRow] = await bqRegional.query({
      query: `SELECT MAX(ingested_ts) as last_ingested FROM \`${projectId}.raw.api_payload\` WHERE (page_status = 'SUCCESS' OR http_status_code = 200) AND endpoint_id = 'nice-cxone-agents-performance'`,
    });
    const lastIngested = latestRow[0]?.last_ingested?.value || null;

    res.json({
      agentActivityCount: activityCount,
      rawPagesCount,
      lastIngested,
    });
  } catch (err: any) {
    console.error("[bq/transform-agents-status]", err.message);
    res.status(500).json({ error: err.message });
  }
});

let downloadJob: {
  status: "idle" | "running" | "completed" | "failed";
  step: string;
  startedAt?: string;
  completedAt?: string;
  loaderExecution?: string;
  processorExecution?: string;
  error?: string;
} = { status: "idle", step: "" };

router.get("/bq/download-job-status", (_req, res) => {
  res.json(downloadJob);
});

router.post("/bq/run-job", async (_req, res) => {
  if (downloadJob.status === "running") {
    res.status(409).json({ error: "Download pipeline is already running", step: downloadJob.step });
    return;
  }
  if (adhocDownloadJob.status === "running") {
    res.status(409).json({ error: "Ad-hoc download is currently running — wait for it to finish", step: adhocDownloadJob.step });
    return;
  }

  downloadJob = { status: "running", step: "starting-loader", startedAt: new Date().toISOString() };

  res.json({ message: "Download pipeline started", status: "running" });

  (async () => {
    try {
      downloadJob.step = "loader-running";
      console.log("[run-job] Step 1: Triggering loader to move call_list.txt → staging queue");
      const loaderResult = await triggerInContactCloudRunJob("incontact-call-loader");
      downloadJob.loaderExecution = loaderResult.executionName;
      console.log("[run-job] Loader triggered:", loaderResult.executionName);

      console.log("[run-job] Waiting for loader to complete...");
      const loaderStatus = await waitForExecution(loaderResult.executionName);
      if (!loaderStatus.succeeded) {
        throw new Error(`Loader failed: ${loaderStatus.error || "unknown error"}`);
      }
      console.log("[run-job] Loader completed successfully");

      downloadJob.step = "processor-running";
      console.log("[run-job] Step 2: Triggering processor to download recordings");
      const processorResult = await triggerInContactCloudRunJob("incontact-call-processor");
      downloadJob.processorExecution = processorResult.executionName;
      console.log("[run-job] Processor triggered:", processorResult.executionName);

      console.log("[run-job] Waiting for processor to complete...");
      const processorStatus = await waitForExecution(processorResult.executionName);
      if (!processorStatus.succeeded) {
        throw new Error(`Processor failed: ${processorStatus.error || "unknown error"}`);
      }
      console.log("[run-job] Processor completed successfully");

      downloadJob.status = "completed";
      downloadJob.step = "done";
      downloadJob.completedAt = new Date().toISOString();
      console.log("[run-job] Download pipeline completed");
    } catch (err: any) {
      downloadJob.status = "failed";
      downloadJob.error = err.message;
      console.error("[run-job] Pipeline failed:", err.message);
    }
  })();
});

router.post("/bq/queue-recordings", async (_req, res) => {
  try {
    const { rules, usedFallback } = await loadActiveDailyRules();
    console.log(`[queue-recordings] Loaded ${rules.length} rule(s)${usedFallback ? " (fallback)" : ""}`);
    const contactIds = await findPendingRecordingContactIds({ rules });
    console.log(`[queue-recordings] Found ${contactIds.length} contacts missing recordings`);

    if (contactIds.length === 0) {
      res.json({ queued: 0, rulesUsed: rules.length, usedFallback, message: "No new recordings to queue" });
      return;
    }

    const written = await writePendingRecordingsToGcs(contactIds, "call_list/call_list.txt");
    console.log(`[queue-recordings] Wrote ${written.count} contact IDs to gs://${written.bucket}/${written.path}`);

    res.json({ queued: written.count, rulesUsed: rules.length, usedFallback });
  } catch (err: any) {
    console.error("[bq/queue-recordings]", err.message);
    res.status(500).json({ error: err.message });
  }
});

const AdhocPullSchema = z.object({
  campaignName: z.string().min(1),
  dispositionPattern: z.string().min(1).optional(),
  dispositionPatterns: z.array(z.string().min(1)).min(1).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).refine(
  (v) => Boolean(v.dispositionPattern) || (v.dispositionPatterns && v.dispositionPatterns.length > 0),
  { message: "Provide dispositionPattern (string) or dispositionPatterns (string[])" },
);

function adhocRulesFromBody(body: z.infer<typeof AdhocPullSchema>): PendingRecordingsRule[] {
  const patterns = body.dispositionPatterns?.length
    ? body.dispositionPatterns
    : body.dispositionPattern
      ? [body.dispositionPattern]
      : [];
  return patterns.map((p) => ({ campaignName: body.campaignName, dispositionPattern: p }));
}

router.post("/bq/queue-recordings/preview", async (req, res) => {
  try {
    const body = AdhocPullSchema.parse(req.body);
    const ids = await findPendingRecordingContactIds({
      rules: adhocRulesFromBody(body),
      dateFrom: body.dateFrom,
      dateTo: body.dateTo,
    });
    res.json({ count: ids.length, sample: ids.slice(0, 5) });
  } catch (err: any) {
    if (err?.issues) {
      res.status(400).json({ error: "Invalid request", details: err.issues });
      return;
    }
    console.error("[bq/queue-recordings/preview]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/bq/queue-recordings/adhoc", async (req, res) => {
  try {
    const body = AdhocPullSchema.parse(req.body);
    const ids = await findPendingRecordingContactIds({
      rules: adhocRulesFromBody(body),
      dateFrom: body.dateFrom,
      dateTo: body.dateTo,
    });
    if (ids.length === 0) {
      res.json({ queued: 0, message: "No matching pending contacts found" });
      return;
    }
    const batchId = `adhoc_${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const written = await writePendingRecordingsToGcs(ids, `call_list/${batchId}.txt`);
    console.log(`[queue-recordings/adhoc] Wrote ${written.count} IDs to gs://${written.bucket}/${written.path}`);
    res.json({
      queued: written.count,
      batchId,
      gcsPath: `gs://${written.bucket}/${written.path}`,
      filter: body,
    });
  } catch (err: any) {
    if (err?.issues) {
      res.status(400).json({ error: "Invalid request", details: err.issues });
      return;
    }
    console.error("[bq/queue-recordings/adhoc]", err.message);
    res.status(500).json({ error: err.message });
  }
});

let adhocDownloadJob: {
  status: "idle" | "running" | "completed" | "failed";
  step: string;
  batchId?: string;
  gcsPath?: string;
  startedAt?: string;
  completedAt?: string;
  loaderExecution?: string;
  processorExecution?: string;
  error?: string;
} = { status: "idle", step: "" };

router.get("/bq/adhoc-download-job-status", (_req, res) => {
  res.json(adhocDownloadJob);
});

const AdhocRunSchema = z.object({
  batchId: z.string().regex(/^adhoc_[A-Za-z0-9_\-:.]+$/, "Invalid batchId"),
});

router.post("/bq/queue-recordings/adhoc/run", async (req, res) => {
  let lockAcquired = false;
  try {
    const { batchId } = AdhocRunSchema.parse(req.body);
    const callListPath = `call_list/${batchId}.txt`;
    const { bucket } = getBqTables();

    // Acquire lock synchronously (no awaits between check and set) to close race window.
    if (adhocDownloadJob.status === "running") {
      res.status(409).json({ error: "Ad-hoc download is already running", step: adhocDownloadJob.step });
      return;
    }
    if (downloadJob.status === "running") {
      res.status(409).json({ error: "Daily download pipeline is currently running — wait for it to finish", step: downloadJob.step });
      return;
    }
    adhocDownloadJob = {
      status: "running",
      step: "verifying-file",
      batchId,
      gcsPath: `gs://${bucket}/${callListPath}`,
      startedAt: new Date().toISOString(),
    };
    lockAcquired = true;

    // Verify the file exists before kicking off Cloud Run jobs.
    const gcsClient = getGCSClient();
    const [exists] = await gcsClient.bucket(bucket).file(callListPath).exists();
    if (!exists) {
      adhocDownloadJob = {
        status: "failed",
        step: "verifying-file",
        batchId,
        gcsPath: `gs://${bucket}/${callListPath}`,
        startedAt: adhocDownloadJob.startedAt,
        completedAt: new Date().toISOString(),
        error: "Batch file not found in GCS",
      };
      res.status(404).json({ error: `Batch file not found: gs://${bucket}/${callListPath}` });
      return;
    }

    adhocDownloadJob.step = "starting-loader";
    res.json({ message: "Ad-hoc download started", batchId, status: "running" });

    (async () => {
      try {
        adhocDownloadJob.step = "loader-running";
        console.log(`[adhoc-run] Loader for ${callListPath}`);
        const loaderResult = await triggerLoaderJob(callListPath);
        adhocDownloadJob.loaderExecution = loaderResult.executionName;
        const loaderStatus = await waitForExecution(loaderResult.executionName);
        if (!loaderStatus.succeeded) {
          throw new Error(`Loader failed: ${loaderStatus.error || "unknown error"}`);
        }

        adhocDownloadJob.step = "processor-running";
        console.log("[adhoc-run] Processor starting");
        const processorResult = await triggerInContactCloudRunJob("incontact-call-processor");
        adhocDownloadJob.processorExecution = processorResult.executionName;
        const processorStatus = await waitForExecution(processorResult.executionName);
        if (!processorStatus.succeeded) {
          throw new Error(`Processor failed: ${processorStatus.error || "unknown error"}`);
        }

        adhocDownloadJob.status = "completed";
        adhocDownloadJob.step = "done";
        adhocDownloadJob.completedAt = new Date().toISOString();
        console.log("[adhoc-run] Completed");
      } catch (err: any) {
        adhocDownloadJob.status = "failed";
        adhocDownloadJob.error = err.message;
        adhocDownloadJob.completedAt = new Date().toISOString();
        console.error("[adhoc-run] Failed:", err.message);
      }
    })();
  } catch (err: any) {
    if (lockAcquired) {
      adhocDownloadJob = {
        ...adhocDownloadJob,
        status: "failed",
        error: err?.message || "Unknown error",
        completedAt: new Date().toISOString(),
      };
    }
    if (err?.issues) {
      res.status(400).json({ error: "Invalid request", details: err.issues });
      return;
    }
    console.error("[bq/queue-recordings/adhoc/run]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/bq/distinct-campaigns", async (_req, res) => {
  try {
    const projectId = getGcpProjectId();
    const bq = getBigQueryClient("US");
    const [rows] = await bq.query({
      query: `SELECT DISTINCT campaign_name FROM \`${projectId}.incontact.calls\` WHERE campaign_name IS NOT NULL ORDER BY campaign_name`,
    });
    res.json({ data: rows.map((r: any) => r.campaign_name).filter(Boolean) });
  } catch (err: any) {
    console.error("[bq/distinct-campaigns]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/bq/distinct-dispositions", async (req, res) => {
  try {
    const projectId = getGcpProjectId();
    const bq = getBigQueryClient("US");
    const campaign = (req.query.campaign as string | undefined) || undefined;
    const params: Record<string, unknown> = {};
    let where = "primary_disposition_name IS NOT NULL";
    if (campaign) {
      where += " AND campaign_name = @campaign";
      params.campaign = campaign;
    }
    const [rows] = await bq.query({
      query: `SELECT DISTINCT primary_disposition_name FROM \`${projectId}.incontact.calls\` WHERE ${where} ORDER BY primary_disposition_name`,
      params,
    });
    res.json({ data: rows.map((r: any) => r.primary_disposition_name).filter(Boolean) });
  } catch (err: any) {
    console.error("[bq/distinct-dispositions]", err.message);
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
