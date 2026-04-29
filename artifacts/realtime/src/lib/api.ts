export const NICE_ENDPOINTS = {
  agents: "/incontactapi/services/v30.0/agents/states",
  skills: "/incontactapi/services/v30.0/skills/activity",
  teams: "/incontactapi/services/v30.0/teams",
  contacts: "/incontactapi/services/v30.0/contacts/active",
} as const;

export type EndpointKey = keyof typeof NICE_ENDPOINTS;

export interface NiceResponse<T = any> {
  statusCode: number;
  statusText: string;
  endpoint: string;
  timestamp: string;
  data: T;
}

export async function fetchNiceData<T = any>(endpointPath: string): Promise<NiceResponse<T>> {
  const res = await fetch("/api/incontact/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: endpointPath }),
  });
  
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  const payload = (await res.json()) as NiceResponse<T>;

  if (typeof payload?.statusCode === "number" && payload.statusCode >= 400) {
    const upstreamMsg =
      (payload as any)?.data?.error?.message ||
      (payload as any)?.data?.message ||
      (typeof payload.data === "string" ? payload.data : null) ||
      payload.statusText ||
      `Upstream HTTP ${payload.statusCode}`;
    throw new Error(`NICE ${payload.statusCode}: ${upstreamMsg}`);
  }

  return payload;
}

export function extractArray(data: unknown): any[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const value of Object.values(data as Record<string, unknown>)) {
      if (Array.isArray(value)) return value;
    }
  }
  return [];
}
