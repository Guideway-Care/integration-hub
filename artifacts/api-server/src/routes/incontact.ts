import { Router, type IRouter } from "express";
import { z } from "zod";
import { getGcpSecretManagerClient, getSecretValue, getBigQueryClient } from "../services/gcp-clients";
import { db, pool } from "@workspace/db";
import {
  sourceSystemTable,
  endpointDefinitionTable,
  endpointParameterTable,
  extractionRunTable,
  scheduledJobRunTable,
} from "@workspace/db/schema";
import { eq, desc, gte, and, lt, inArray } from "drizzle-orm";
import { DAILY_JOBS, DAILY_JOBS_LIST } from "../config/daily-jobs";

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
    path: "/incontactapi/services/v30.0/agents/states",
    name: "Agent States (Real-Time)",
    description: "Real-time snapshot of all currently logged-in agents with their state, available flag, and the contact ID they are currently handling (if any).",
    method: "GET",
    category: "Real-Time",
    params: [
      { name: "agentStateId", label: "Agent State ID", type: "string", description: "Filter to a specific agent state" },
      { name: "agentId", label: "Agent ID", type: "string", description: "Filter to a specific agent" },
      { name: "teamId", label: "Team ID", type: "string", description: "Filter to a specific team" },
      { name: "fields", label: "Fields", type: "string", placeholder: "agentId,agentStateName,contactId", description: "Comma-separated fields to return" },
    ],
  },
  {
    path: "/incontactapi/services/v30.0/skills/activity",
    name: "Skills Activity (Real-Time)",
    description: "Real-time activity by skill — calls in queue, agents available, longest queued, etc.",
    method: "GET",
    category: "Real-Time",
    params: [
      { name: "skillId", label: "Skill ID", type: "string", description: "Filter to a specific skill" },
      { name: "mediaTypeId", label: "Media Type ID", type: "string", description: "Filter to a specific media type (e.g. 4=Phone)" },
      { name: "fields", label: "Fields", type: "string", placeholder: "skillId,skillName,callsInQueue", description: "Comma-separated fields to return" },
    ],
  },
  {
    path: "/incontactapi/services/v30.0/teams",
    name: "Teams",
    description: "List all teams configured in the NICE CXone system.",
    method: "GET",
    category: "Workforce",
    params: [
      { name: "fields", label: "Fields", type: "string", placeholder: "teamId,teamName", description: "Comma-separated list of fields to return" },
    ],
  },
  {
    path: "/incontactapi/services/v30.0/teams/performance-summary",
    name: "Teams Performance Summary (Real-Time)",
    description: "Real-time performance summary for each team — agents logged in, on call, available, etc.",
    method: "GET",
    category: "Real-Time",
    params: [
      { name: "teamId", label: "Team ID", type: "string", description: "Filter to a specific team" },
      { name: "fields", label: "Fields", type: "string", placeholder: "teamId,teamName,agentsLoggedIn", description: "Comma-separated fields to return" },
    ],
  },
  {
    path: "/incontactapi/services/v30.0/contacts/chats/{contactId}",
    name: "Chat Transcript",
    description: "Retrieve the full transcript for a chat contact, including all messages exchanged between agent and customer.",
    method: "GET",
    category: "Contacts",
    params: [
      { name: "contactId", label: "Contact ID", type: "string", required: true, placeholder: "698822631732", description: "The numeric contact ID of the chat session" },
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
    const msg = err?.message || "Failed to fetch from InContact API";
    const isAuth = /UNAUTHENTICATED|invalid authentication|invalid_grant|access[_ ]denied/i.test(msg);
    const isDev = process.env.NODE_ENV !== "production";
    // In dev, GCP Secret Manager is unreachable without service-account creds.
    // Avoid flooding the log with 500 stack traces — return a quiet envelope so
    // the realtime poller can render "disconnected" instead of triggering
    // platform error-rate alerts.
    if (isDev && isAuth) {
      res.status(200).json({
        statusCode: 503,
        statusText: "Service Unavailable (dev: no GCP credentials)",
        endpoint: req.body?.endpoint,
        timestamp: new Date().toISOString(),
        data: null,
        devNotice: "InContact fetch disabled in dev — GCP Secret Manager unreachable.",
      });
      return;
    }
    console.error("[incontact/fetch]", msg);
    res.status(500).json({
      error: isAuth
        ? `GCP credential rejected: ${msg}`
        : `Failed to fetch from InContact API: ${msg}`,
    });
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

router.get("/incontact/dispositions-stats", async (_req, res) => {
  try {
    const bq = getBigQueryClient();
    const [rows] = await bq.query({
      query: `SELECT
                COUNT(*) AS total,
                COUNTIF(is_active) AS active,
                COUNTIF(NOT is_active) AS inactive,
                FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', MAX(TIMESTAMP_MILLIS(last_updated))) AS newest_last_updated
              FROM \`incontact.dispositions\``,
      location: "US",
    });
    const r = (rows[0] ?? {}) as any;
    res.json({
      total: Number(r.total ?? 0),
      active: Number(r.active ?? 0),
      inactive: Number(r.inactive ?? 0),
      newestLastUpdated: r.newest_last_updated ?? null,
    });
  } catch (err: any) {
    console.error("[incontact/dispositions-stats]", err.message);
    res.status(500).json({ error: err.message || "Failed to load disposition stats" });
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

function chicagoDayStartInUTC(dateStr: string): Date {
  // dateStr = "YYYY-MM-DD" interpreted as a Chicago calendar day.
  // Returns the UTC instant when Chicago local time crosses 00:00 on that date.
  const [y, m, d] = dateStr.split("-").map(Number);
  // Probe at 12:00 UTC of the same calendar date — guaranteed to fall on the
  // same Chicago calendar day (Chicago is UTC-5 or UTC-6, so 12:00Z = 06:00 or 07:00 Chicago).
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    hour12: false,
  });
  const hourPart = fmt.formatToParts(probe).find((p) => p.type === "hour");
  const chicagoHourAtNoonUTC = parseInt(hourPart!.value, 10) % 24;
  // Offset (UTC ahead of Chicago) at noon UTC; midnight Chicago is at the same offset.
  const offsetHours = 12 - chicagoHourAtNoonUTC;
  return new Date(Date.UTC(y, m - 1, d, offsetHours, 0, 0));
}

function addDaysISO(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const u = new Date(Date.UTC(y, m - 1, d));
  u.setUTCDate(u.getUTCDate() + days);
  return `${u.getUTCFullYear()}-${String(u.getUTCMonth() + 1).padStart(2, "0")}-${String(u.getUTCDate()).padStart(2, "0")}`;
}

function getYesterdayInChicago(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const todayChicago = fmt.format(new Date());
  const [y, m, d] = todayChicago.split("-").map(Number);
  const u = new Date(Date.UTC(y, m - 1, d));
  u.setUTCDate(u.getUTCDate() - 1);
  const yy = u.getUTCFullYear();
  const mm = String(u.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(u.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function getTodayInChicago(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Records the start of a scheduled/daily job run and returns the row id so the
 * caller can finalize it. DB failures are swallowed (logged only) so that
 * persistence problems never break the actual extraction/transform work.
 */
async function startScheduledRunRecord(
  jobName: string,
  runDate: string,
  trigger: "manual" | "scheduled",
): Promise<string | null> {
  try {
    const [row] = await db
      .insert(scheduledJobRunTable)
      .values({ jobName, runDate, trigger, status: "running", phase: "extract", startedAt: new Date() })
      .returning({ id: scheduledJobRunTable.id });
    return row?.id ?? null;
  } catch (err: any) {
    console.error(`[scheduled-run] Failed to record start for ${jobName} ${runDate}:`, err.message);
    return null;
  }
}

async function finishScheduledRunRecord(
  id: string | null,
  patch: {
    status: "completed" | "failed";
    phase?: string;
    durationMs?: number;
    error?: string;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  if (!id) return;
  try {
    await db
      .update(scheduledJobRunTable)
      .set({
        status: patch.status,
        phase: patch.phase,
        durationMs: patch.durationMs,
        error: patch.error,
        detailJson: patch.detail ?? null,
        completedAt: new Date(),
      })
      .where(eq(scheduledJobRunTable.id, id));
  } catch (err: any) {
    console.error(`[scheduled-run] Failed to record completion for ${id}:`, err.message);
  }
}

async function verifyGoogleOidcToken(req: any): Promise<{ ok: true; email: string } | { ok: false; reason: string }> {
  const auth = req.headers.authorization;
  if (typeof auth !== "string" || !auth.startsWith("Bearer ")) {
    return { ok: false, reason: "Missing Bearer token" };
  }
  const token = auth.substring("Bearer ".length).trim();
  try {
    const { OAuth2Client } = await import("google-auth-library" as string);
    const client = new OAuth2Client();
    const projectId = process.env.GCP_PROJECT_ID || "guidewaycare-476802";
    const rawExpected =
      process.env.SCHEDULER_SERVICE_ACCOUNT || `scheduler-sa@${projectId}.iam.gserviceaccount.com`;
    const expectedSas = rawExpected
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0);
    // Derive accepted audiences from the actual incoming request so that any
    // valid Cloud Run alias (hash-based, project-number-based, project-id-based,
    // or a custom domain) works without env config.
    const host = req.get?.("host") || req.headers?.host;
    const proto = (req.headers?.["x-forwarded-proto"] as string) || req.protocol || "https";
    const reqUrl = host ? `${proto}://${host}${req.originalUrl || req.url || ""}` : undefined;
    const acceptedAudiences = [
      reqUrl,
      host ? `${proto}://${host}` : undefined,
      process.env.API_SERVER_URL ? `${process.env.API_SERVER_URL}/api/incontact/agents-daily-job` : undefined,
      process.env.API_SERVER_URL,
    ].filter((v): v is string => typeof v === "string" && v.length > 0);
    // verifyIdToken validates signature/issuer/expiry; we then check audience + email ourselves.
    const ticket = await client.verifyIdToken({ idToken: token });
    const payload = ticket.getPayload();
    if (!payload?.aud || !acceptedAudiences.includes(String(payload.aud))) {
      return { ok: false, reason: `Audience mismatch: token=${payload?.aud} accepted=${acceptedAudiences.join("|")}` };
    }
    const tokenEmail = (payload?.email || "").trim().toLowerCase();
    if (!tokenEmail || !expectedSas.includes(tokenEmail)) {
      return { ok: false, reason: `Wrong service account: token=${payload?.email} expected=${expectedSas.join("|")}` };
    }
    return { ok: true, email: payload.email };
  } catch (err: any) {
    return { ok: false, reason: err.message };
  }
}

let agentsScheduledJob: {
  status: "idle" | "running" | "completed" | "failed";
  phase: "extract" | "transform" | "done" | "";
  date?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
  trigger?: "manual" | "scheduled";
} = { status: "idle", phase: "" };

export function getAgentsScheduledJob() {
  return agentsScheduledJob;
}

async function runAgentsScheduledJob(date: string, trigger: "manual" | "scheduled") {
  const startTs = Date.now();
  agentsScheduledJob = {
    status: "running",
    phase: "extract",
    date,
    startedAt: new Date().toISOString(),
    trigger,
  };
  const recordId = await startScheduledRunRecord(DAILY_JOBS.agents.jobName, date, trigger);
  try {
    await runAgentsDailyExtraction(date, date);
    if (agentsDailyJob.status !== "completed") {
      const failed = agentsDailyJob.results.filter((r) => r.status !== "COMPLETED");
      throw new Error(
        `Extraction did not complete cleanly: ${failed.map((r) => `${r.date}=${r.status}`).join(", ")}`,
      );
    }

    agentsScheduledJob.phase = "transform";
    const { startAgentsTransformPipeline, getAgentsTransformJob } = await import("./bq");
    if (!startAgentsTransformPipeline()) {
      throw new Error("Transform was already running");
    }
    while (getAgentsTransformJob().status === "running") {
      await new Promise((r) => setTimeout(r, 3000));
    }
    const transform = getAgentsTransformJob();
    if (transform.status !== "completed") {
      throw new Error(`Transform failed: ${transform.error || "unknown error"}`);
    }

    agentsScheduledJob = {
      ...agentsScheduledJob,
      status: "completed",
      phase: "done",
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startTs,
    };
    await finishScheduledRunRecord(recordId, {
      status: "completed",
      phase: "done",
      durationMs: Date.now() - startTs,
    });
    console.log(`[agents-scheduled] Completed for ${date} in ${Math.round((Date.now() - startTs) / 1000)}s`);
  } catch (err: any) {
    agentsScheduledJob = {
      ...agentsScheduledJob,
      status: "failed",
      error: err.message,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startTs,
    };
    await finishScheduledRunRecord(recordId, {
      status: "failed",
      phase: agentsScheduledJob.phase,
      durationMs: Date.now() - startTs,
      error: err.message,
    });
    console.error(`[agents-scheduled] Failed for ${date}:`, err.message);
  }
}

router.post("/incontact/agents-daily-job", async (req, res) => {
  try {
    const claimedTrigger: "manual" | "scheduled" = req.body?.trigger === "scheduled" ? "scheduled" : "manual";
    if (claimedTrigger === "scheduled" && process.env.NODE_ENV !== "development") {
      const verdict = await verifyGoogleOidcToken(req);
      if (!verdict.ok) {
        console.warn(`[agents-daily-job] OIDC rejected: ${verdict.reason}`);
        res.status(401).json({ error: "Unauthorized scheduler call", reason: verdict.reason });
        return;
      }
    }
    if (agentsScheduledJob.status === "running") {
      res.status(409).json({
        error: "Agents daily job already running",
        phase: agentsScheduledJob.phase,
        date: agentsScheduledJob.date,
      });
      return;
    }

    const date: string = (req.body?.date as string) || getYesterdayInChicago();
    runAgentsScheduledJob(date, claimedTrigger);
    res.json({ message: "Agents daily job started", date, trigger: claimedTrigger });
  } catch (err: any) {
    console.error("[incontact/agents-daily-job]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/incontact/agents-daily-job/status", async (_req, res) => {
  res.json({
    data: agentsScheduledJob,
    yesterdayChicago: getYesterdayInChicago(),
  });
});

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

// =============================================================================
// Contacts daily scheduled pipeline (mirrors agents pattern)
// Steps: extract → transform → queue-recordings → download (loader+processor)
// =============================================================================

let contactsDailyJob: {
  status: "idle" | "running" | "completed" | "failed";
  totalDays: number;
  completedDays: number;
  currentDay?: string;
  results: { date: string; runId: string; status: string }[];
  error?: string;
} = { status: "idle", totalDays: 0, completedDays: 0, results: [] };

async function runContactsDailyExtraction(startDate: string, endDate: string) {
  const ENDPOINT_ID = "nice-cxone-contacts";
  // startDate/endDate are Chicago calendar dates. Build per-day windows whose
  // boundaries are Chicago-local midnight → next Chicago-local midnight,
  // expressed as UTC instants (DST-correct).
  const days: { dayStart: string; dayEnd: string; label: string }[] = [];
  let label = startDate;
  while (label <= endDate) {
    const startUTC = chicagoDayStartInUTC(label);
    const nextLabel = addDaysISO(label, 1);
    const endUTC = chicagoDayStartInUTC(nextLabel);
    days.push({
      dayStart: startUTC.toISOString().replace(".000Z", "Z"),
      dayEnd: endUTC.toISOString().replace(".000Z", "Z"),
      label,
    });
    label = nextLabel;
  }

  contactsDailyJob = { status: "running", totalDays: days.length, completedDays: 0, results: [] };

  for (const day of days) {
    contactsDailyJob.currentDay = day.label;
    console.log(`[contacts-daily] Processing ${day.label} (${contactsDailyJob.completedDays + 1}/${days.length})`);
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
          console.log(`[contacts-daily] Waiting for active run ${lockResult.rows[0].run_id} to finish...`);
          const activeStatus = await waitForRunCompletion(lockResult.rows[0].run_id);
          console.log(`[contacts-daily] Active run finished with status: ${activeStatus}`);
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
        requestedBy: "control-plane-contacts-daily",
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

      const finalStatus = await waitForRunCompletion(created.runId, 600000);
      contactsDailyJob.results.push({ date: day.label, runId: created.runId, status: finalStatus });
      contactsDailyJob.completedDays++;
      console.log(`[contacts-daily] ${day.label} finished: ${finalStatus}`);
    } catch (err: any) {
      console.error(`[contacts-daily] ${day.label} failed:`, err.message);
      contactsDailyJob.results.push({ date: day.label, runId: "error", status: err.message });
      contactsDailyJob.completedDays++;
    }
  }

  const allSuccess = contactsDailyJob.results.every((r) => r.status === "COMPLETED");
  contactsDailyJob.status = allSuccess ? "completed" : "failed";
  contactsDailyJob.currentDay = undefined;
  console.log(`[contacts-daily] All days done. Success: ${allSuccess}`);
}

let contactsScheduledJob: {
  status: "idle" | "running" | "completed" | "failed";
  phase: "extract" | "transform" | "queue" | "download" | "done" | "";
  date?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
  trigger?: "manual" | "scheduled";
  queuedCount?: number;
  rulesUsed?: number;
  usedFallback?: boolean;
  loaderExecution?: string;
  processorExecution?: string;
} = { status: "idle", phase: "" };

export function getContactsScheduledJob() {
  return contactsScheduledJob;
}

async function runContactsScheduledJob(date: string, trigger: "manual" | "scheduled") {
  const startTs = Date.now();
  contactsScheduledJob = {
    status: "running",
    phase: "extract",
    date,
    startedAt: new Date().toISOString(),
    trigger,
  };
  const recordId = await startScheduledRunRecord(DAILY_JOBS.contacts.jobName, date, trigger);
  try {
    // Phase 1: Extract
    await runContactsDailyExtraction(date, date);
    if (contactsDailyJob.status !== "completed") {
      const failed = contactsDailyJob.results.filter((r) => r.status !== "COMPLETED");
      throw new Error(`Extraction did not complete cleanly: ${failed.map((r) => `${r.date}=${r.status}`).join(", ")}`);
    }

    // Phase 2: Transform
    contactsScheduledJob.phase = "transform";
    const bqMod = await import("./bq");
    if (!bqMod.startContactsTransformPipeline()) {
      throw new Error("Contacts transform was already running");
    }
    while (bqMod.getContactsTransformJob().status === "running") {
      await new Promise((r) => setTimeout(r, 3000));
    }
    const transform = bqMod.getContactsTransformJob();
    if (transform.status !== "completed") {
      throw new Error(`Transform failed: ${transform.error || "unknown error"}`);
    }

    // Phase 3: Queue recordings (uses DB rules, falls back to defaults)
    contactsScheduledJob.phase = "queue";
    const { rules, usedFallback } = await bqMod.loadActiveDailyRules();
    contactsScheduledJob.rulesUsed = rules.length;
    contactsScheduledJob.usedFallback = usedFallback;
    const ids = await bqMod.findPendingRecordingContactIds({
      rules,
      minDurationSeconds: bqMod.DEFAULT_MIN_DURATION_SECONDS,
    });
    contactsScheduledJob.queuedCount = ids.length;

    if (ids.length === 0) {
      // Nothing to download; mark complete after queue phase
      contactsScheduledJob = {
        ...contactsScheduledJob,
        status: "completed",
        phase: "done",
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTs,
      };
      await finishScheduledRunRecord(recordId, {
        status: "completed",
        phase: "done",
        durationMs: Date.now() - startTs,
        detail: {
          queuedCount: 0,
          rulesUsed: contactsScheduledJob.rulesUsed,
          usedFallback: contactsScheduledJob.usedFallback,
          note: "no new recordings to download",
        },
      });
      console.log(`[contacts-scheduled] Completed for ${date} — no new recordings to download`);
      return;
    }
    await bqMod.writePendingRecordingsToGcs(ids, "call_list/call_list.txt");

    // Phase 4: Download (loader → processor)
    contactsScheduledJob.phase = "download";
    const cr = await import("./bq");
    // Reuse the same triggers used by /bq/run-job — they're in bq.ts but private.
    // We expose a tiny helper through a fetch to our own /bq/run-job? No — run-job is fire-and-forget.
    // Instead, replicate the chain inline using the exported triggers we just imported.
    // (triggerInContactCloudRunJob and waitForExecution aren't exported; we add wrappers below.)
    const { triggerLoaderJob, triggerProcessorJob, awaitExecution, LOADER_WAIT_MS } = cr;
    const loader = await triggerLoaderJob();
    contactsScheduledJob.loaderExecution = loader.executionName;
    const loaderStatus = await awaitExecution(loader.executionName, LOADER_WAIT_MS);
    if (!loaderStatus.succeeded) {
      throw new Error(`Loader failed: ${loaderStatus.error || "unknown error"}`);
    }
    const processor = await triggerProcessorJob();
    contactsScheduledJob.processorExecution = processor.executionName;

    // Persist success NOW, before waiting on the processor. The processor is a
    // self-completing Cloud Run job that drains the queue on its own, but this
    // api-server instance can be recycled at any point while idly awaiting it
    // (Cloud Run scale-down lost the final status write on Jul 15, 2026 — the
    // run showed "failed" even though every step succeeded). If the processor
    // genuinely fails, the best-effort watch below or the self-heal queue
    // watchdog surfaces it.
    contactsScheduledJob = {
      ...contactsScheduledJob,
      status: "completed",
      phase: "done",
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startTs,
    };
    await finishScheduledRunRecord(recordId, {
      status: "completed",
      phase: "done",
      durationMs: Date.now() - startTs,
      detail: {
        queuedCount: contactsScheduledJob.queuedCount,
        rulesUsed: contactsScheduledJob.rulesUsed,
        usedFallback: contactsScheduledJob.usedFallback,
        note: "recordings queued and processor triggered; download drains inside the processor job",
      },
    });
    console.log(
      `[contacts-scheduled] Completed for ${date} in ${Math.round((Date.now() - startTs) / 1000)}s — recording download draining in processor job`,
    );

    // Best-effort watch: only to flag a definitive processor failure. If this
    // instance dies mid-wait, the run record above is already final.
    try {
      const processorStatus = await awaitExecution(processor.executionName);
      if (processorStatus.done && !processorStatus.succeeded) {
        const errMsg = `Processor failed: ${processorStatus.error || "unknown error"}`;
        contactsScheduledJob = {
          ...contactsScheduledJob,
          status: "failed",
          error: errMsg,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startTs,
        };
        await finishScheduledRunRecord(recordId, {
          status: "failed",
          phase: "download",
          durationMs: Date.now() - startTs,
          error: errMsg,
          detail: {
            queuedCount: contactsScheduledJob.queuedCount,
            rulesUsed: contactsScheduledJob.rulesUsed,
            usedFallback: contactsScheduledJob.usedFallback,
          },
        });
        console.error(`[contacts-scheduled] Processor failed after completion was recorded for ${date}: ${errMsg}`);
      }
    } catch (watchErr: any) {
      console.warn(`[contacts-scheduled] Processor watch ended early (instance may be recycling): ${watchErr.message}`);
    }
  } catch (err: any) {
    contactsScheduledJob = {
      ...contactsScheduledJob,
      status: "failed",
      error: err.message,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startTs,
    };
    await finishScheduledRunRecord(recordId, {
      status: "failed",
      phase: contactsScheduledJob.phase,
      durationMs: Date.now() - startTs,
      error: err.message,
      detail: {
        queuedCount: contactsScheduledJob.queuedCount,
        rulesUsed: contactsScheduledJob.rulesUsed,
        usedFallback: contactsScheduledJob.usedFallback,
      },
    });
    console.error(`[contacts-scheduled] Failed for ${date}:`, err.message);
  }
}

router.post("/incontact/contacts-daily-job", async (req, res) => {
  try {
    const claimedTrigger: "manual" | "scheduled" = req.body?.trigger === "scheduled" ? "scheduled" : "manual";
    if (claimedTrigger === "scheduled" && process.env.NODE_ENV !== "development") {
      const verdict = await verifyGoogleOidcToken(req);
      if (!verdict.ok) {
        console.warn(`[contacts-daily-job] OIDC rejected: ${verdict.reason}`);
        res.status(401).json({ error: "Unauthorized scheduler call", reason: verdict.reason });
        return;
      }
    }
    // Note: this lock releases at processor-trigger time (run is recorded
    // "completed" while the drain continues inside the processor job), so a
    // re-trigger during an active drain would start a duplicate single-drainer
    // processor execution. Avoid manual re-runs while a drain is in flight.
    if (contactsScheduledJob.status === "running") {
      res.status(409).json({
        error: "Contacts daily job already running",
        phase: contactsScheduledJob.phase,
        date: contactsScheduledJob.date,
      });
      return;
    }
    const date: string = (req.body?.date as string) || getYesterdayInChicago();
    runContactsScheduledJob(date, claimedTrigger);
    res.json({ message: "Contacts daily job started", date, trigger: claimedTrigger });
  } catch (err: any) {
    console.error("[incontact/contacts-daily-job]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/incontact/contacts-daily-job/status", async (_req, res) => {
  res.json({ data: contactsScheduledJob, yesterdayChicago: getYesterdayInChicago() });
});

// =============================================================================
// Contacts historical backfill — call METADATA only (extract + transform).
// Never touches recordings: it never writes call_list.txt, never triggers the
// loader/processor, and DEFAULT_PENDING_RECORDINGS_FLOOR keeps backfilled
// history out of the daily queue step as well.
//
// Designed to survive Cloud Run instance recycling (the known killer of
// long background orchestration here):
//  - progress is persisted to scheduled_job_run (jobName 'contacts-backfill')
//    as a heartbeat after every day;
//  - days whose extraction_run is already COMPLETED for the exact window are
//    skipped, so re-running the same range only does the missing days;
//  - the self-heal sweep auto-resumes a 'running' backfill whose heartbeat
//    has gone stale (instance died) — no operator action needed.
// =============================================================================

const BACKFILL_JOB_NAME = "contacts-backfill";
export const BACKFILL_HEARTBEAT_STALE_MINUTES = 30;
const BACKFILL_MAX_DAYS = 400;
/** Extraction runs stuck PENDING/RUNNING longer than this are dead orchestrations. */
const EXTRACTION_RUN_STALE_MINUTES = 30;

let contactsBackfillJob: {
  status: "idle" | "running" | "completed" | "failed";
  startDate?: string;
  endDate?: string;
  totalDays: number;
  completedDays: number;
  skippedDays: number;
  failedDays: number;
  currentDay?: string;
  phase: "extract" | "transform" | "done" | "";
  startedAt?: string;
  completedAt?: string;
  error?: string;
} = { status: "idle", totalDays: 0, completedDays: 0, skippedDays: 0, failedDays: 0, phase: "" };

async function updateBackfillHeartbeat(recordId: string | null): Promise<void> {
  if (!recordId) return;
  try {
    await db
      .update(scheduledJobRunTable)
      .set({
        phase: contactsBackfillJob.phase,
        detailJson: {
          startDate: contactsBackfillJob.startDate,
          endDate: contactsBackfillJob.endDate,
          totalDays: contactsBackfillJob.totalDays,
          completedDays: contactsBackfillJob.completedDays,
          skippedDays: contactsBackfillJob.skippedDays,
          failedDays: contactsBackfillJob.failedDays,
          currentDay: contactsBackfillJob.currentDay,
          lastProgressAt: new Date().toISOString(),
        },
      })
      .where(eq(scheduledJobRunTable.id, recordId));
  } catch (err: any) {
    console.error(`[contacts-backfill] Heartbeat update failed:`, err.message);
  }
}

/**
 * Fails extraction runs stuck PENDING/RUNNING beyond the stale threshold
 * (dead orchestrations / crashed jobs), so serialization waits don't burn
 * their timeout on ghosts. Called at backfill start AND before each day —
 * a run can go stale mid-loop (e.g. a TIMEOUT'd extraction that died).
 */
async function failStaleContactsExtractionRuns(endpointId: string): Promise<void> {
  const staleCutoff = new Date(Date.now() - EXTRACTION_RUN_STALE_MINUTES * 60 * 1000);
  const staled = await db
    .update(extractionRunTable)
    .set({
      status: "FAILED",
      endedTs: new Date(),
      errorSummary: `auto-failed by backfill: stuck PENDING/RUNNING > ${EXTRACTION_RUN_STALE_MINUTES} min (orchestrator likely died)`,
    })
    .where(
      and(
        eq(extractionRunTable.endpointId, endpointId),
        inArray(extractionRunTable.status, ["PENDING", "RUNNING"]),
        lt(extractionRunTable.createdTs, staleCutoff),
      ),
    )
    .returning({ runId: extractionRunTable.runId });
  if (staled.length > 0) {
    console.log(`[contacts-backfill] Auto-failed ${staled.length} stale extraction run(s)`);
  }
}

async function runContactsBackfill(startDate: string, endDate: string, recordId: string | null) {
  const ENDPOINT_ID = "nice-cxone-contacts";
  // Set state synchronously so a second POST racing this one sees "running".
  contactsBackfillJob = {
    status: "running",
    startDate,
    endDate,
    totalDays: 0,
    completedDays: 0,
    skippedDays: 0,
    failedDays: 0,
    phase: "extract",
    startedAt: new Date().toISOString(),
  };
  const startTs = Date.now();

  // Per-day Chicago-local windows, same construction as the daily job so the
  // skip check below matches daily-created runs exactly.
  const days: { dayStart: Date; dayEnd: Date; label: string }[] = [];
  let label = startDate;
  while (label <= endDate) {
    const nextLabel = addDaysISO(label, 1);
    days.push({ dayStart: chicagoDayStartInUTC(label), dayEnd: chicagoDayStartInUTC(nextLabel), label });
    label = nextLabel;
  }
  contactsBackfillJob.totalDays = days.length;

  // Best-effort keepalive: give Cloud Run request traffic while the loop runs.
  // NOT relied upon for correctness (no instance affinity) — the heartbeat +
  // self-heal resume is the real safety net.
  let keepalive: ReturnType<typeof setInterval> | null = null;
  if (process.env.API_SERVER_URL) {
    keepalive = setInterval(() => {
      fetch(`${process.env.API_SERVER_URL}/api/healthz`).catch(() => {});
    }, 60_000);
    keepalive.unref();
  }

  try {
    await failStaleContactsExtractionRuns(ENDPOINT_ID);

    for (const day of days) {
      contactsBackfillJob.currentDay = day.label;

      // Resume/idempotency: skip days already extracted (by this backfill, a
      // previous attempt, or the daily job) for the exact same window.
      const existing = await db
        .select({ runId: extractionRunTable.runId })
        .from(extractionRunTable)
        .where(
          and(
            eq(extractionRunTable.endpointId, ENDPOINT_ID),
            eq(extractionRunTable.status, "COMPLETED"),
            eq(extractionRunTable.windowStartTs, day.dayStart),
            eq(extractionRunTable.windowEndTs, day.dayEnd),
          ),
        )
        .limit(1);
      if (existing.length > 0) {
        contactsBackfillJob.skippedDays++;
        contactsBackfillJob.completedDays++;
        await updateBackfillHeartbeat(recordId);
        continue;
      }

      // A run can go stale mid-loop too (e.g. an extraction that died after a
      // TIMEOUT'd wait) — clear ghosts before checking for active runs.
      await failStaleContactsExtractionRuns(ENDPOINT_ID);

      // Serialize with the daily job (and anything else) on this endpoint.
      const active = await db
        .select({ runId: extractionRunTable.runId })
        .from(extractionRunTable)
        .where(
          and(
            eq(extractionRunTable.endpointId, ENDPOINT_ID),
            inArray(extractionRunTable.status, ["PENDING", "RUNNING"]),
          ),
        )
        .limit(1);
      if (active.length > 0) {
        console.log(`[contacts-backfill] Waiting for active run ${active[0].runId} to finish...`);
        await waitForRunCompletion(active[0].runId, 600000);
      }

      const [created] = await db
        .insert(extractionRunTable)
        .values({
          sourceSystemId: "nice-cxone",
          endpointId: ENDPOINT_ID,
          runType: "MANUAL",
          requestedBy: "control-plane-backfill",
          windowStartTs: day.dayStart,
          windowEndTs: day.dayEnd,
          status: "PENDING",
        })
        .returning();

      const execName = await triggerExtractionJobForRun(created.runId);
      if (execName) {
        await db
          .update(extractionRunTable)
          .set({ cloudRunJobName: EXTRACTION_JOB_NAME, cloudRunExecutionId: execName })
          .where(eq(extractionRunTable.runId, created.runId));
      }

      const finalStatus = await waitForRunCompletion(created.runId, 600000);
      if (finalStatus !== "COMPLETED") {
        contactsBackfillJob.failedDays++;
        console.error(`[contacts-backfill] ${day.label} did not complete: ${finalStatus}`);
      }
      contactsBackfillJob.completedDays++;
      await updateBackfillHeartbeat(recordId);
      console.log(
        `[contacts-backfill] ${day.label}: ${finalStatus} (${contactsBackfillJob.completedDays}/${contactsBackfillJob.totalDays})`,
      );
    }

    // One full-rebuild transform sweeps everything from raw into incontact.calls.
    contactsBackfillJob.phase = "transform";
    contactsBackfillJob.currentDay = undefined;
    await updateBackfillHeartbeat(recordId);
    const bqMod = await import("./bq");
    let transformStarted = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (bqMod.startContactsTransformPipeline()) {
        transformStarted = true;
        break;
      }
      // Another transform (e.g. the daily job's) is mid-flight — wait our turn.
      // Keep heartbeating so self-heal on another instance doesn't mistake this
      // wait for a dead loop and start a duplicate backfill.
      await updateBackfillHeartbeat(recordId);
      await new Promise((r) => setTimeout(r, 30_000));
    }
    if (!transformStarted) throw new Error("Could not start transform: another transform stayed busy for 20 minutes");
    const transformDeadline = Date.now() + 45 * 60 * 1000;
    for (;;) {
      const t = bqMod.getContactsTransformJob();
      if (t.status === "completed") break;
      if (t.status === "failed") throw new Error(`Transform failed: ${t.error || "unknown error"}`);
      if (Date.now() > transformDeadline) throw new Error("Timed out waiting for transform to complete");
      // Heartbeat through the (potentially long) transform so the stale check
      // never fires while this loop is alive.
      await updateBackfillHeartbeat(recordId);
      await new Promise((r) => setTimeout(r, 10_000));
    }

    const failed = contactsBackfillJob.failedDays;
    contactsBackfillJob = {
      ...contactsBackfillJob,
      status: failed > 0 ? "failed" : "completed",
      phase: "done",
      currentDay: undefined,
      completedAt: new Date().toISOString(),
      error:
        failed > 0
          ? `${failed} day(s) did not extract cleanly — start the same range again to retry just those days`
          : undefined,
    };
    await finishScheduledRunRecord(recordId, {
      status: failed > 0 ? "failed" : "completed",
      phase: "done",
      durationMs: Date.now() - startTs,
      error: contactsBackfillJob.error,
      detail: {
        startDate,
        endDate,
        totalDays: contactsBackfillJob.totalDays,
        completedDays: contactsBackfillJob.completedDays,
        skippedDays: contactsBackfillJob.skippedDays,
        failedDays: failed,
        lastProgressAt: new Date().toISOString(),
      },
    });
    console.log(
      `[contacts-backfill] Finished ${startDate}..${endDate}: ${contactsBackfillJob.totalDays} days, ${contactsBackfillJob.skippedDays} skipped, ${failed} failed`,
    );
  } catch (err: any) {
    console.error(`[contacts-backfill] Failed:`, err.message);
    contactsBackfillJob = {
      ...contactsBackfillJob,
      status: "failed",
      completedAt: new Date().toISOString(),
      error: err.message,
    };
    await finishScheduledRunRecord(recordId, {
      status: "failed",
      phase: contactsBackfillJob.phase,
      durationMs: Date.now() - startTs,
      error: err.message,
      detail: {
        startDate,
        endDate,
        totalDays: contactsBackfillJob.totalDays,
        completedDays: contactsBackfillJob.completedDays,
        skippedDays: contactsBackfillJob.skippedDays,
        failedDays: contactsBackfillJob.failedDays,
        lastProgressAt: new Date().toISOString(),
      },
    });
  } finally {
    if (keepalive) clearInterval(keepalive);
  }
}

/**
 * Called by the self-heal sweep: if a backfill row is 'running' in the DB but
 * no loop is alive on this instance and the heartbeat is stale, the driving
 * instance died — restart the loop. Skip logic makes this idempotent.
 */
export async function resumeOrphanedContactsBackfill(): Promise<void> {
  if (contactsBackfillJob.status === "running") return;
  const [row] = await db
    .select()
    .from(scheduledJobRunTable)
    .where(and(eq(scheduledJobRunTable.jobName, BACKFILL_JOB_NAME), eq(scheduledJobRunTable.status, "running")))
    .orderBy(desc(scheduledJobRunTable.createdTs))
    .limit(1);
  if (!row) return;
  const detail = (row.detailJson ?? {}) as Record<string, any>;
  const lastProgress = detail.lastProgressAt
    ? new Date(detail.lastProgressAt).getTime()
    : row.startedAt
      ? new Date(row.startedAt).getTime()
      : 0;
  if (Date.now() - lastProgress < BACKFILL_HEARTBEAT_STALE_MINUTES * 60 * 1000) return;
  if (typeof detail.startDate !== "string" || typeof detail.endDate !== "string") {
    await finishScheduledRunRecord(row.id, {
      status: "failed",
      error: "backfill state row has no date range; cannot auto-resume",
    });
    return;
  }
  console.log(
    `[contacts-backfill] Auto-resuming orphaned backfill ${detail.startDate}..${detail.endDate} (no heartbeat since ${detail.lastProgressAt || row.startedAt?.toISOString?.() || "start"})`,
  );
  runContactsBackfill(detail.startDate, detail.endDate, row.id);
}

router.post("/incontact/extract-contacts-daily", async (req, res) => {
  try {
    const { startDate, endDate } = req.body || {};
    const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (!isDate(startDate) || !isDate(endDate)) {
      res.status(400).json({ error: "startDate and endDate are required (YYYY-MM-DD)" });
      return;
    }
    if (startDate > endDate) {
      res.status(400).json({ error: "startDate must be on or before endDate" });
      return;
    }
    if (endDate >= getTodayInChicago()) {
      res.status(400).json({ error: "endDate must be a past date (the daily job covers yesterday onward)" });
      return;
    }
    let dayCount = 0;
    for (let d = startDate; d <= endDate; d = addDaysISO(d, 1)) dayCount++;
    if (dayCount > BACKFILL_MAX_DAYS) {
      res.status(400).json({ error: `Range too large: ${dayCount} days (max ${BACKFILL_MAX_DAYS})` });
      return;
    }
    if (contactsBackfillJob.status === "running") {
      res.status(409).json({
        error: "A backfill is already running",
        progress: `${contactsBackfillJob.completedDays}/${contactsBackfillJob.totalDays}`,
        currentDay: contactsBackfillJob.currentDay,
      });
      return;
    }
    // Cross-instance guard: a 'running' DB row with a fresh heartbeat means
    // another instance is actively driving a backfill.
    const [activeRow] = await db
      .select()
      .from(scheduledJobRunTable)
      .where(and(eq(scheduledJobRunTable.jobName, BACKFILL_JOB_NAME), eq(scheduledJobRunTable.status, "running")))
      .orderBy(desc(scheduledJobRunTable.createdTs))
      .limit(1);
    if (activeRow) {
      const d = (activeRow.detailJson ?? {}) as Record<string, any>;
      const last = d.lastProgressAt
        ? new Date(d.lastProgressAt).getTime()
        : activeRow.startedAt
          ? new Date(activeRow.startedAt).getTime()
          : 0;
      if (Date.now() - last < BACKFILL_HEARTBEAT_STALE_MINUTES * 60 * 1000) {
        res.status(409).json({
          error: "A backfill is already running (driven by another server instance)",
          progress: d.totalDays ? `${d.completedDays ?? 0}/${d.totalDays}` : undefined,
        });
        return;
      }
      // Stale row with a dead driver: close it out; the new request supersedes it.
      await finishScheduledRunRecord(activeRow.id, {
        status: "failed",
        error: "superseded by a new backfill request after the driving instance died",
      });
    }

    const recordId = await startScheduledRunRecord(BACKFILL_JOB_NAME, `${startDate}..${endDate}`, "manual");
    runContactsBackfill(startDate, endDate, recordId);
    await updateBackfillHeartbeat(recordId);
    res.json({ message: "Backfill started (call data only — no recordings)", startDate, endDate, dayCount });
  } catch (err: any) {
    console.error("[incontact/extract-contacts-daily]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/incontact/extract-contacts-daily/status", async (_req, res) => {
  let lastRecord: Record<string, unknown> | null = null;
  try {
    const [row] = await db
      .select()
      .from(scheduledJobRunTable)
      .where(eq(scheduledJobRunTable.jobName, BACKFILL_JOB_NAME))
      .orderBy(desc(scheduledJobRunTable.createdTs))
      .limit(1);
    if (row) {
      lastRecord = {
        id: row.id,
        status: row.status,
        phase: row.phase,
        runDate: row.runDate,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        error: row.error,
        detail: row.detailJson ?? null,
      };
    }
  } catch {
    // history is best-effort; in-memory state still answers
  }
  res.json({ data: contactsBackfillJob, lastRecord });
});

// A run still marked "running" after this long is almost certainly a process that
// died mid-job (in-memory state was lost on restart) — surface it as stale.
const SCHEDULED_RUN_STALE_MS = 2 * 60 * 60 * 1000;

router.get("/incontact/scheduled-jobs/history", async (req, res) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days ?? "3"), 10) || 3, 1), 30);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const now = Date.now();

  const schedules = DAILY_JOBS_LIST.map((j) => ({
    jobName: j.jobName,
    humanLabel: j.humanLabel,
    description: j.description,
    schedule: j.schedule,
    timeZone: j.timeZone,
  }));

  const current: Record<string, unknown> = {
    [DAILY_JOBS.agents.jobName]: getAgentsScheduledJob(),
    [DAILY_JOBS.contacts.jobName]: getContactsScheduledJob(),
  };

  const jobs: Record<string, { runs: any[]; current: unknown }> = {};
  for (const j of DAILY_JOBS_LIST) {
    jobs[j.jobName] = { runs: [], current: current[j.jobName] };
  }

  let historyAvailable = true;
  try {
    const rows = await db
      .select()
      .from(scheduledJobRunTable)
      .where(gte(scheduledJobRunTable.createdTs, cutoff))
      .orderBy(desc(scheduledJobRunTable.createdTs));

    for (const row of rows) {
      const bucket = jobs[row.jobName];
      if (!bucket) continue;
      const startedMs = row.startedAt ? new Date(row.startedAt).getTime() : null;
      const stale =
        row.status === "running" && startedMs != null && now - startedMs > SCHEDULED_RUN_STALE_MS;
      bucket.runs.push({
        id: row.id,
        jobName: row.jobName,
        runDate: row.runDate,
        trigger: row.trigger,
        status: row.status,
        phase: row.phase,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        durationMs: row.durationMs,
        error: row.error,
        detail: row.detailJson,
        createdTs: row.createdTs,
        stale,
      });
    }
  } catch (err: any) {
    // Table may not be migrated yet (cold start / pre-migration deploy). Degrade
    // gracefully so the dashboard renders the schedule with an empty history.
    historyAvailable = false;
    console.error("[scheduled-jobs/history] query failed:", err.message);
  }

  res.json({
    schedules,
    jobs,
    days,
    historyAvailable,
    nowChicago: getTodayInChicago(),
    yesterdayChicago: getYesterdayInChicago(),
  });
});

export default router;
