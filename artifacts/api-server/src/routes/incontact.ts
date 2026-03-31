import { Router, type IRouter } from "express";
import { z } from "zod";
import { getGcpSecretManagerClient, getSecretValue } from "../services/gcp-clients";

const ALLOWED_ENDPOINTS = [
  "/media-playback/v1/contacts",
  "/incontactapi/services/v30.0/contacts/completed",
  "/incontactapi/services/v30.0/contacts/active",
  "/incontactapi/services/v30.0/agents",
  "/incontactapi/services/v30.0/skills/summary",
];

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
  res.json(ALLOWED_ENDPOINTS);
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

export default router;
