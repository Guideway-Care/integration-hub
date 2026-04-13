import { Router, type IRouter } from "express";
import { z } from "zod";
import { getGcpSecretManagerClient, getSecretValue, getBigQueryClient } from "../services/gcp-clients";
import { db, pool } from "@workspace/db";
import {
  sourceSystemTable,
  endpointDefinitionTable,
  endpointParameterTable,
  extractionRunTable,
} from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";

interface EndpointParam {
  name: string;
  label: string;
  type: "string" | "date" | "number" | "boolean";
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  description?: string;
}

interface EndpointDef {
  path: string;
  name: string;
  description: string;
  method: "GET" | "POST";
  category: string;
  params: EndpointParam[];
}

const ENDPOINT_DEFS: EndpointDef[] = [
  {
    path: "/incontactapi/services/v30.0/contacts/completed",
    name: "Completed Contacts",
    description: "Retrieve completed contact records for a given date range. Returns call metadata including agents, dispositions, and duration.",
    method: "GET",
    category: "Contacts",
    params: [
      { name: "startDate", label: "Start Date", type: "date", required: true, placeholder: "2026-04-01", description: "Start of date range (YYYY-MM-DD)" },
      { name: "endDate", label: "End Date", type: "date", required: true, placeholder: "2026-04-01", description: "End of date range (YYYY-MM-DD)" },
      { name: "updatedSince", label: "Updated Since", type: "string", placeholder: "2026-04-01T00:00:00Z", description: "Only return records updated after this timestamp" },
      { name: "fields", label: "Fields", type: "string", placeholder: "contactId,agentId,teamName", description: "Comma-separated list of fields to return" },
      { name: "skip", label: "Skip", type: "number", placeholder: "0", description: "Number of records to skip (pagination)" },
      { name: "top", label: "Top", type: "number", placeholder: "1000", description: "Max records to return (default 1000)" },
      { name: "orderBy", label: "Order By", type: "string", placeholder: "lastUpdateTime desc", description: "Field and direction to sort by" },
    ],
  },
  {
    path: "/incontactapi/services/v30.0/contacts/active",
    name: "Active Contacts",
    description: "Retrieve currently active contacts across all skills and agents.",
    method: "GET",
    category: "Contacts",
    params: [
      { name: "updatedSince", label: "Updated Since", type: "string", placeholder: "2026-04-01T00:00:00Z", description: "Only return records updated after this timestamp" },
      { name: "fields", label: "Fields", type: "string", placeholder: "contactId,agentId", description: "Comma-separated list of fields to return" },
      { name: "skip", label: "Skip", type: "number", placeholder: "0" },
      { name: "top", label: "Top", type: "number", placeholder: "1000" },
    ],
  },
  {
    path: "/media-playback/v1/contacts",
    name: "Media Playback",
    description: "Retrieve media playback URLs for call recordings by contact ID.",
    method: "GET",
    category: "Media",
    params: [
      { name: "contactId", label: "Contact ID", type: "string", required: true, placeholder: "698822631732", description: "The numeric contact ID to retrieve media for" },
    ],
  },
  {
    path: "/incontactapi/services/v28.0/dispositions",
    name: "Dispositions",
    description: "Retrieve all disposition codes configured in the NICE CXone system. Dispositions are used to categorize the outcome of a contact.",
    method: "GET",
    category: "Contacts",
    params: [
      { name: "updatedSince", label: "Updated Since", type: "string", placeholder: "2026-04-01T00:00:00Z", description: "Only return dispositions updated after this timestamp" },
      { name: "fields", label: "Fields", type: "string", placeholder: "dispositionId,dispositionName", description: "Comma-separated list of fields to return" },
      { name: "skip", label: "Skip", type: "number", placeholder: "0", description: "Number of records to skip (pagination)" },
      { name: "top", label: "Top", type: "number", placeholder: "100", description: "Max records to return" },
    ],
  },
  {
    path: "/incontactapi/services/v27.0/contacts/{contactId}/statehistory",
    name: "Contact State History",
    description: "Retrieve the state history for a specific contact, showing how it transitioned through different states (e.g., routing, queued, active, disconnected).",
    method: "GET",
    category: "Contacts",
    params: [
      { name: "contactId", label: "Contact ID", type: "string", required: true, placeholder: "698822631732", description: "The numeric contact ID to retrieve state history for" },
    ],
  },
  {
    path: "/incontactapi/services/v30.0/agents",
    name: "Agents",
    description: "List all agents configured in the NICE CXone system with their profiles and status.",
    method: "GET",
    category: "Workforce",
    params: [
      { name: "updatedSince", label: "Updated Since", type: "string", placeholder: "2026-04-01T00:00:00Z", description: "Only return agents updated after this timestamp" },
      { name: "fields", label: "Fields", type: "string", placeholder: "agentId,firstName,lastName", description: "Comma-separated list of fields to return" },
      { name: "skip", label: "Skip", type: "number", placeholder: "0" },
      { name: "top", label: "Top", type: "number", placeholder: "100" },
    ],
  },
  {
    path: "/incontactapi/services/v27.0/agents/performance",
    name: "Agents Performance",
    description: "Retrieve performance metrics for all agents over a specified time range. Data needs at least 15 minutes to migrate to the warehouse before it is fully accurate.",
    method: "GET",
    category: "Workforce",
    params: [
      { name: "startDate", label: "Start Date", type: "date", required: true, placeholder: "2026-04-01", description: "Start of reporting interval (YYYY-MM-DD)" },
      { name: "endDate", label: "End Date", type: "date", required: true, placeholder: "2026-04-01", description: "End of reporting interval (YYYY-MM-DD)" },
      { name: "fields", label: "Fields", type: "string", placeholder: "agentId,agentName,totalCalls", description: "Comma-separated list of fields to return" },
      { name: "skip", label: "Skip", type: "number", placeholder: "0", description: "Number of records to skip (pagination)" },
      { name: "top", label: "Top", type: "number", placeholder: "100", description: "Max records to return" },
      { name: "orderBy", label: "Order By", type: "string", placeholder: "agentName asc", description: "Field and direction to sort by" },
    ],
  },
  {
    path: "/incontactapi/services/v30.0/skills/summary",
    name: "Skills Summary",
    description: "Get a summary of all configured skills including queue counts and service level data.",
    method: "GET",
    category: "Workforce",
    params: [
      { name: "fields", label: "Fields", type: "string", placeholder: "skillId,skillName,contactsQueued", description: "Comma-separated list of fields to return" },
    ],
  },
];

const ALLOWED_ENDPOINTS = ENDPOINT_DEFS.map((e) => e.path);

function isEndpointAllowed(endpoint: string): boolean {
  return ALLOWED_ENDPOINTS.some((allowed) => {
    const pattern = allowed.replace(/\{[^}]+\}/g, "[^/]+");
    return new RegExp(`^${pattern}$`).test(endpoint) || allowed === endpoint;
  });
}

const fetchBodySchema = z.object({
  endpoint: z.string().refine((val) => isEndpointAllowed(val), {
    message: "Endpoint not in allowlist",
  }),
  params: z.record(z.string()).optional(),
});

async function getInContactBearerToken(): Promise<{ token: string; projectId: string; resourceServerBaseUri: string; apiBaseUri: string; tokenMeta: Record<string, any> }> {
  const { client, projectId } = await getGcpSecretManagerClient();
  const accessKeyId = await getSecretValue(client, projectId, "inContact-Client-Id");
  const accessKeySecret = await getSecretValue(client, projectId, "inContact-Client-Secret");

  const tokenResponse = await fetch("https://na1.nice-incontact.com/authentication/v1/token/access-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessKeyId, accessKeySecret }),
  });

  if (!tokenResponse.ok) {
    const errText = await tokenResponse.text();
    throw new Error(`Token request failed (${tokenResponse.status}): ${errText}`);
  }

  const tokenData = await tokenResponse.json() as any;
  const resourceServerBaseUri = tokenData.resource_server_base_uri || "https://na1.nice-incontact.com";
  let apiBaseUri = resourceServerBaseUri;
  try {
    const parsed = new URL(resourceServerBaseUri);
    if (!parsed.hostname.startsWith("api-")) {
      const match = parsed.hostname.match(/^([^.]+)\./);
      if (match) {
        apiBaseUri = `${parsed.protocol}//api-${match[1]}.niceincontact.com`;
      }
    }
  } catch {}
  const tokenMeta: Record<string, any> = {};
  for (const key of Object.keys(tokenData)) {
    if (key !== "access_token" && key !== "refresh_token") {
      tokenMeta[key] = tokenData[key];
    }
  }
  return { token: tokenData.access_token, projectId, resourceServerBaseUri, apiBaseUri, tokenMeta };
}

const router: IRouter = Router();

router.get("/incontact/test", async (_req, res) => {
  try {
    const { client, projectId } = await getGcpSecretManagerClient();
    await getSecretValue(client, projectId, "inContact-Client-Id");
    await getSecretValue(client, projectId, "inContact-Client-Secret");
    res.json({
      status: "connected",
      secretRetrieved: true,
      project: projectId,
      secrets: ["inContact-Client-Id", "inContact-Client-Secret"],
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[incontact/test]", err.message);
    const isConfig = err.message.includes("not configured");
    res.status(500).json({ error: isConfig ? "GCP service account not configured" : "Unable to connect to GCP Secret Manager" });
  }
});

router.get("/incontact/endpoints", (_req, res) => {
  res.json(ENDPOINT_DEFS);
});

router.post("/incontact/auth-test", async (_req, res) => {
  try {
    const { token, resourceServerBaseUri, apiBaseUri } = await getInContactBearerToken();
    res.json({
      authenticated: true,
      resourceServerBaseUri,
      apiBaseUri,
      tokenLength: token.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[incontact/auth-test]", err.message);
    res.status(500).json({ error: "Authentication failed — check that your Client ID and Secret are valid access keys" });
  }
});

router.post("/incontact/fetch", async (req, res) => {
  try {
    const parsed = fetchBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }

    const { token, resourceServerBaseUri, apiBaseUri } = await getInContactBearerToken();
    const { endpoint, params } = parsed.data;

    let resolvedPath = endpoint;
    const queryParams: Record<string, string> = {};
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (resolvedPath.includes(`{${k}}`)) {
          resolvedPath = resolvedPath.replace(`{${k}}`, encodeURIComponent(v));
        } else {
          queryParams[k] = v;
        }
      });
    }

    const url = new URL(`${apiBaseUri}${resolvedPath}`);
    Object.entries(queryParams).forEach(([k, v]) => url.searchParams.set(k, v));

    console.log(`[incontact/fetch] URL: ${url.toString()}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const apiResponse = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const contentType = apiResponse.headers.get("content-type") || "";
    let data: any;
    if (contentType.includes("application/json")) {
      data = await apiResponse.json();
    } else {
      data = await apiResponse.text();
    }

    res.json({
      statusCode: apiResponse.status,
      statusText: apiResponse.statusText,
      endpoint: url.pathname,
      timestamp: new Date().toISOString(),
      data,
    });
  } catch (err: any) {
    console.error("[incontact/fetch]", err.message);
    res.status(500).json({ error: "Failed to fetch from InContact API" });
  }
});

async function fetchInContactEndpoint(
  token: string,
  apiBaseUri: string,
  endpointPath: string,
  params?: Record<string, string>,
): Promise<any> {
  const url = new URL(`${apiBaseUri}${endpointPath}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  console.log(`[incontact] Fetching: ${url.toString()}`);
  const apiResponse = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!apiResponse.ok) {
    const errText = await apiResponse.text();
    throw new Error(`API request failed (${apiResponse.status}): ${errText.substring(0, 200)}`);
  }
  return apiResponse.json();
}

router.post("/incontact/sync-dispositions", async (_req, res) => {
  try {
    const { token, apiBaseUri } = await getInContactBearerToken();
    const bq = getBigQueryClient();

    const endpointPath = ENDPOINT_DEFS.find(e => e.name === "Dispositions")!.path;
    let allDispositions: any[] = [];
    let skip = 0;
    const top = 1000;
    let hasMore = true;

    while (hasMore) {
      const data = await fetchInContactEndpoint(token, apiBaseUri, endpointPath, {
        skip: String(skip),
        top: String(top),
      });

      const dispositions = data.resultSet?.dispositions || data.dispositions || [];
      console.log(`[sync-dispositions] Page at skip=${skip}: got ${dispositions.length} dispositions. Keys: ${JSON.stringify(Object.keys(data))}`);
      allDispositions = allDispositions.concat(dispositions);

      if (dispositions.length < top) {
        hasMore = false;
      } else {
        skip += top;
      }
    }

    if (allDispositions.length === 0) {
      res.json({ synced: 0, message: "No dispositions returned from API" });
      return;
    }

    const rows = allDispositions.map((d: any) => ({
      disposition_id: d.dispositionId ?? null,
      disposition_name: d.dispositionName ?? null,
      notes: d.notes ?? null,
      last_updated: d.lastUpdated ? new Date(d.lastUpdated).getTime() : null,
      classification_id: d.classificationId ?? null,
      system_outcome: d.systemOutcome ?? null,
      is_active: d.isActive ?? null,
      is_preview_disposition: d.isPreviewDisposition ?? null,
    }));

    const dataset = bq.dataset("incontact");
    const table = dataset.table("dispositions");

    await bq.query({
      query: "DELETE FROM `incontact.dispositions` WHERE TRUE",
      location: "US",
    });

    await table.insert(rows, { skipInvalidRows: false, ignoreUnknownValues: false });

    res.json({
      synced: rows.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[incontact/sync-dispositions]", err.message);
    res.status(500).json({ error: err.message || "Failed to sync dispositions" });
  }
});

router.post("/incontact/seed-agents-endpoint", async (_req, res) => {
  try {
    const SOURCE_SYSTEM_ID = "nice-cxone";
    const ENDPOINT_ID = "nice-cxone-agents-performance";

    const [existingSource] = await db
      .select()
      .from(sourceSystemTable)
      .where(eq(sourceSystemTable.sourceSystemId, SOURCE_SYSTEM_ID))
      .limit(1);

    if (!existingSource) {
      await db.insert(sourceSystemTable).values({
        sourceSystemId: SOURCE_SYSTEM_ID,
        sourceSystemName: "NICE CXone",
        baseUrl: "https://api-na1.niceincontact.com",
        authType: "OAUTH2_CLIENT_CREDENTIALS",
        secretManagerSecretName: "nice-cxone-api-credentials",
        isActive: true,
      });
    }

    const [existingEndpoint] = await db
      .select()
      .from(endpointDefinitionTable)
      .where(eq(endpointDefinitionTable.endpointId, ENDPOINT_ID))
      .limit(1);

    if (!existingEndpoint) {
      await db.insert(endpointDefinitionTable).values({
        endpointId: ENDPOINT_ID,
        sourceSystemId: SOURCE_SYSTEM_ID,
        endpointName: "Agents Performance",
        httpMethod: "GET",
        relativePath: "/incontactapi/services/v27.0/agents/performance",
        paginationStrategy: "NONE",
        paginationConfigJson: null,
        incrementalStrategy: "DATE_WINDOW",
        incrementalConfigJson: {
          startDateParam: "startDate",
          endDateParam: "endDate",
          dateFormat: "YYYY-MM-DDTHH:mm:ssZ",
          safetyLagMinutes: 15,
        },
        rateLimitConfigJson: { maxRetries: 3, maxBackoffMs: 60000, backoffStrategy: "EXPONENTIAL", initialBackoffMs: 1000, requestsPerSecond: 5 },
        isActive: true,
      });
    }

    const paramDefs = [
      { id: "agents-perf-startDate", name: "startDate", label: "Start Date", location: "QUERY", dataType: "DATETIME", required: true, order: 1, help: "ISO 8601 beginning of report interval" },
      { id: "agents-perf-endDate", name: "endDate", label: "End Date", location: "QUERY", dataType: "DATETIME", required: true, order: 2, help: "ISO 8601 end of report interval (must use T00:00:00Z quarter-hour boundary)" },
    ];

    for (const p of paramDefs) {
      const [existing] = await db
        .select()
        .from(endpointParameterTable)
        .where(eq(endpointParameterTable.endpointParameterId, p.id))
        .limit(1);

      if (!existing) {
        await db.insert(endpointParameterTable).values({
          endpointParameterId: p.id,
          endpointId: ENDPOINT_ID,
          parameterName: p.name,
          parameterLabel: p.label,
          parameterLocation: p.location,
          dataType: p.dataType,
          isRequired: p.required,
          helpText: p.help,
          displayOrder: p.order,
          isActive: true,
        });
      }
    }

    res.json({
      message: "Agents performance endpoint seeded successfully",
      sourceSystemId: SOURCE_SYSTEM_ID,
      endpointId: ENDPOINT_ID,
      created: !existingEndpoint,
    });
  } catch (err: any) {
    console.error("[incontact/seed-agents-endpoint]", err.message);
    res.status(500).json({ error: err.message || "Failed to seed agents endpoint" });
  }
});

router.get("/incontact/agents-last-run", async (_req, res) => {
  try {
    const [lastRun] = await db
      .select()
      .from(extractionRunTable)
      .where(eq(extractionRunTable.endpointId, "nice-cxone-agents-performance"))
      .orderBy(desc(extractionRunTable.createdTs))
      .limit(1);

    res.json({ data: lastRun ?? null });
  } catch (err: any) {
    console.error("[incontact/agents-last-run]", err.message);
    res.status(500).json({ error: err.message });
  }
});

const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID || "guidewaycare-476802";
const GCP_REGION = process.env.GCP_REGION || "us-central1";
const EXTRACTION_JOB_NAME = process.env.EXTRACTION_JOB_NAME || "extraction-job";

async function getAccessToken(): Promise<string> {
  const resp = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } },
  );
  if (!resp.ok) throw new Error(`Failed to get access token: ${resp.status}`);
  const data = await resp.json() as { access_token: string };
  return data.access_token;
}

async function triggerExtractionJobForRun(runId: string): Promise<string | null> {
  try {
    const token = await getAccessToken();
    const url = `https://${GCP_REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${GCP_PROJECT_ID}/jobs/${EXTRACTION_JOB_NAME}:run`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        overrides: { containerOverrides: [{ env: [{ name: "RUN_ID", value: runId }] }] },
      }),
    });
    if (!resp.ok) {
      console.error(`[agents-daily] Failed to trigger job: ${resp.status}`);
      return null;
    }
    const d = await resp.json() as { metadata?: { name?: string } };
    return d.metadata?.name ?? null;
  } catch (err) {
    console.error("[agents-daily] Trigger error:", err);
    return null;
  }
}

async function waitForRunCompletion(runId: string, timeoutMs = 120000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const [run] = await db
      .select({ status: extractionRunTable.status })
      .from(extractionRunTable)
      .where(eq(extractionRunTable.runId, runId))
      .limit(1);
    if (!run) return "NOT_FOUND";
    if (run.status !== "PENDING" && run.status !== "RUNNING") return run.status;
    await new Promise((r) => setTimeout(r, 5000));
  }
  return "TIMEOUT";
}

let agentsDailyJob: {
  status: "idle" | "running" | "completed" | "failed";
  totalDays: number;
  completedDays: number;
  currentDay?: string;
  results: { date: string; runId: string; status: string }[];
  error?: string;
} = { status: "idle", totalDays: 0, completedDays: 0, results: [] };

async function runAgentsDailyExtraction(startDate: string, endDate: string) {
  const ENDPOINT_ID = "nice-cxone-agents-performance";
  const start = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  const days: { dayStart: string; dayEnd: string; label: string }[] = [];
  const current = new Date(start);
  while (current <= end) {
    const dayStart = current.toISOString().replace(".000Z", "Z");
    const nextDay = new Date(current);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const dayEnd = nextDay.toISOString().replace(".000Z", "Z");
    days.push({ dayStart, dayEnd, label: current.toISOString().split("T")[0] });
    current.setUTCDate(current.getUTCDate() + 1);
  }

  agentsDailyJob = { status: "running", totalDays: days.length, completedDays: 0, results: [] };

  for (const day of days) {
    agentsDailyJob.currentDay = day.label;
    console.log(`[agents-daily] Processing ${day.label} (${agentsDailyJob.completedDays + 1}/${days.length})`);

    try {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const lockResult = await client.query(
          `SELECT run_id, status FROM extraction_run WHERE endpoint_id = $1 AND status IN ('PENDING', 'RUNNING') FOR UPDATE`,
          [ENDPOINT_ID],
        );
        if (lockResult.rows.length > 0) {
          await client.query("ROLLBACK");
          console.log(`[agents-daily] Waiting for active run ${lockResult.rows[0].run_id} to finish...`);
          const activeStatus = await waitForRunCompletion(lockResult.rows[0].run_id);
          console.log(`[agents-daily] Active run finished with status: ${activeStatus}`);
        } else {
          await client.query("ROLLBACK");
        }
      } finally {
        client.release();
      }

      const [created] = await db.insert(extractionRunTable).values({
        sourceSystemId: "nice-cxone",
        endpointId: ENDPOINT_ID,
        runType: "MANUAL",
        requestedBy: "control-plane-daily",
        windowStartTs: new Date(day.dayStart),
        windowEndTs: new Date(day.dayEnd),
        status: "PENDING",
      }).returning();

      const execName = await triggerExtractionJobForRun(created.runId);
      if (execName) {
        await db.update(extractionRunTable)
          .set({ cloudRunJobName: EXTRACTION_JOB_NAME, cloudRunExecutionId: execName })
          .where(eq(extractionRunTable.runId, created.runId));
      }

      const finalStatus = await waitForRunCompletion(created.runId, 300000);
      agentsDailyJob.results.push({ date: day.label, runId: created.runId, status: finalStatus });
      agentsDailyJob.completedDays++;
      console.log(`[agents-daily] ${day.label} finished: ${finalStatus}`);
    } catch (err: any) {
      console.error(`[agents-daily] ${day.label} failed:`, err.message);
      agentsDailyJob.results.push({ date: day.label, runId: "error", status: err.message });
      agentsDailyJob.completedDays++;
    }
  }

  const allSuccess = agentsDailyJob.results.every((r) => r.status === "COMPLETED");
  agentsDailyJob.status = allSuccess ? "completed" : "failed";
  agentsDailyJob.currentDay = undefined;
  console.log(`[agents-daily] All days done. Success: ${allSuccess}`);
}

router.post("/incontact/extract-agents-daily", async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    if (!startDate || !endDate) {
      res.status(400).json({ error: "startDate and endDate are required (YYYY-MM-DD)" });
      return;
    }
    if (agentsDailyJob.status === "running") {
      res.status(409).json({
        error: "Daily agent extraction is already running",
        currentDay: agentsDailyJob.currentDay,
        progress: `${agentsDailyJob.completedDays}/${agentsDailyJob.totalDays}`,
      });
      return;
    }

    const start = new Date(startDate + "T00:00:00Z");
    const end = new Date(endDate + "T00:00:00Z");
    const dayCount = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;

    runAgentsDailyExtraction(startDate, endDate);

    res.json({ message: "Daily agent extraction started", dayCount, startDate, endDate });
  } catch (err: any) {
    console.error("[incontact/extract-agents-daily]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/incontact/extract-agents-daily/status", async (_req, res) => {
  res.json({ data: agentsDailyJob });
});

export default router;
