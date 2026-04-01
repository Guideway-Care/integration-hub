import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

export interface AuthCredentials {
  type: "API_KEY" | "OAUTH2_CLIENT_CREDENTIALS" | "BASIC" | "BEARER_TOKEN";
  apiKey?: string;
  clientId?: string;
  clientSecret?: string;
  accessKeyId?: string;
  accessKeySecret?: string;
  tokenUrl?: string;
  username?: string;
  password?: string;
  bearerToken?: string;
  scopes?: string[];
}

interface CachedToken {
  accessToken: string;
  issuedAt: number;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();
const credentialsCache = new Map<string, AuthCredentials>();

export async function resolveCredentials(
  secretName: string,
): Promise<AuthCredentials> {
  if (process.env.NODE_ENV === "development" || !secretName) {
    const mockCreds = process.env[`SECRET_${secretName.toUpperCase().replace(/-/g, "_")}`];
    if (mockCreds) {
      return JSON.parse(mockCreds) as AuthCredentials;
    }
    throw new Error(`Secret "${secretName}" not found. Set SECRET_${secretName.toUpperCase().replace(/-/g, "_")} env var for local dev.`);
  }

  const client = new SecretManagerServiceClient();
  const gcpProject = process.env.GCP_PROJECT_ID;
  if (!gcpProject) {
    throw new Error("GCP_PROJECT_ID environment variable is required for Secret Manager");
  }
  const fullSecretName = secretName.startsWith("projects/")
    ? `${secretName}/versions/latest`
    : `projects/${gcpProject}/secrets/${secretName}/versions/latest`;
  const [version] = await client.accessSecretVersion({
    name: fullSecretName,
  });

  const payload = version.payload?.data;
  if (!payload) {
    throw new Error(`Secret "${secretName}" has no payload data`);
  }

  const secretData = typeof payload === "string" ? payload : Buffer.from(payload as Uint8Array).toString("utf-8");
  return JSON.parse(secretData) as AuthCredentials;
}

async function acquireOAuth2Token(
  credentials: AuthCredentials,
  cacheKey: string,
  forceRefresh = false,
): Promise<{ token: string; refreshed: boolean }> {
  if (!forceRefresh) {
    const cached = tokenCache.get(cacheKey);
    if (cached) {
      const now = Date.now();
      const totalTtl = cached.expiresAt - cached.issuedAt;
      const ttlRemaining = cached.expiresAt - now;
      if (ttlRemaining > totalTtl * 0.1) {
        return { token: cached.accessToken, refreshed: false };
      }
    }
  }

  const tokenUrl = credentials.tokenUrl;
  if (!tokenUrl) throw new Error("OAuth2 tokenUrl is required");

  const isAccessKey = !!(credentials.accessKeyId && credentials.accessKeySecret);

  let response: Response;

  if (isAccessKey) {
    response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accessKeyId: credentials.accessKeyId,
        accessKeySecret: credentials.accessKeySecret,
      }),
    });
  } else {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: credentials.clientId || "",
      client_secret: credentials.clientSecret || "",
    });

    if (credentials.scopes?.length) {
      body.set("scope", credentials.scopes.join(" "));
    }

    response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OAuth2 token acquisition failed: ${response.status} ${text}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number; token_type?: string };
  const now = Date.now();
  const expiresInMs = (data.expires_in || 3600) * 1000;

  console.log(`[Auth] Token acquired, expires_in=${data.expires_in}s (${Math.round(expiresInMs / 1000 / 60)}min)`);

  tokenCache.set(cacheKey, {
    accessToken: data.access_token,
    issuedAt: now,
    expiresAt: now + expiresInMs,
  });

  return { token: data.access_token, refreshed: true };
}

export interface AuthResult {
  headers: Record<string, string>;
  refreshed: boolean;
}

export class AuthManager {
  private authType: string;
  private secretName: string | null;
  private sourceSystemId: string;
  private credentials: AuthCredentials | null = null;
  private cacheKey: string;

  constructor(authType: string, secretName: string | null, sourceSystemId: string) {
    this.authType = authType;
    this.secretName = secretName;
    this.sourceSystemId = sourceSystemId;
    this.cacheKey = `${sourceSystemId}:${secretName}`;
  }

  async init(): Promise<void> {
    if (!this.secretName) return;

    const cached = credentialsCache.get(this.cacheKey);
    if (cached) {
      this.credentials = cached;
      return;
    }

    this.credentials = await resolveCredentials(this.secretName);
    credentialsCache.set(this.cacheKey, this.credentials);
  }

  async getHeaders(forceRefresh = false): Promise<AuthResult> {
    if (!this.secretName || !this.credentials) {
      return { headers: {}, refreshed: false };
    }

    switch (this.authType) {
      case "API_KEY": {
        return {
          headers: { Authorization: `ApiKey ${this.credentials.apiKey}` },
          refreshed: false,
        };
      }

      case "OAUTH2_CLIENT_CREDENTIALS": {
        const result = await acquireOAuth2Token(this.credentials, this.cacheKey, forceRefresh);
        return {
          headers: { Authorization: `Bearer ${result.token}` },
          refreshed: result.refreshed,
        };
      }

      case "BASIC": {
        const encoded = Buffer.from(
          `${this.credentials.username}:${this.credentials.password}`,
        ).toString("base64");
        return {
          headers: { Authorization: `Basic ${encoded}` },
          refreshed: false,
        };
      }

      case "BEARER_TOKEN": {
        return {
          headers: { Authorization: `Bearer ${this.credentials.bearerToken}` },
          refreshed: false,
        };
      }

      default:
        throw new Error(`Unsupported auth type: ${this.authType}`);
    }
  }

  isOAuth2(): boolean {
    return this.authType === "OAUTH2_CLIENT_CREDENTIALS";
  }
}

export async function getAuthHeaders(
  authType: string,
  secretManagerSecretName: string | null,
  sourceSystemId: string,
): Promise<AuthResult> {
  const mgr = new AuthManager(authType, secretManagerSecretName, sourceSystemId);
  await mgr.init();
  return mgr.getHeaders();
}

export function clearTokenCache(): void {
  tokenCache.clear();
  credentialsCache.clear();
}
