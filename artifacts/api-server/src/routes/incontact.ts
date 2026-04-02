import { Router, type IRouter } from "express";
import { z } from "zod";
import { getGcpSecretManagerClient, getSecretValue } from "../services/gcp-clients";

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
    path: "/incontactapi/services/v30.0/dispositions",
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

const fetchBodySchema = z.object({
  endpoint: z.string().refine((val) => ALLOWED_ENDPOINTS.includes(val), {
    message: "Endpoint not in allowlist",
  }),
  params: z.record(z.string()).optional(),
});

async function getInContactBearerToken(): Promise<{ token: string; projectId: string; resourceServerBaseUri: string }> {
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
  return { token: tokenData.access_token, projectId, resourceServerBaseUri };
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
    const { token, resourceServerBaseUri } = await getInContactBearerToken();
    res.json({
      authenticated: true,
      resourceServerBaseUri,
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

    const { token, resourceServerBaseUri } = await getInContactBearerToken();
    const { endpoint, params } = parsed.data;

    const url = new URL(`${resourceServerBaseUri}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }

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

router.post("/incontact/sync-dispositions", async (_req, res) => {
  try {
    const { token, resourceServerBaseUri } = await getInContactBearerToken();
    const bq = getBigQueryClient();

    let allDispositions: any[] = [];
    let skip = 0;
    const top = 1000;
    let hasMore = true;

    while (hasMore) {
      const url = new URL(`${resourceServerBaseUri}/incontactapi/services/v30.0/dispositions`);
      url.searchParams.set("skip", String(skip));
      url.searchParams.set("top", String(top));

      const apiResponse = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });

      if (!apiResponse.ok) {
        const errText = await apiResponse.text();
        throw new Error(`API request failed (${apiResponse.status}): ${errText}`);
      }

      const data = await apiResponse.json() as any;
      const dispositions = data.resultSet?.dispositions || data.dispositions || [];
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

export default router;
