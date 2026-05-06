import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { endpointDefinitionTable } from "@workspace/db/schema";

function getGcpConfig(): { projectId: string; region: string } {
  const projectId = process.env.GCP_PROJECT_ID || "guidewaycare-476802";
  const region = process.env.GCP_REGION || "us-central1";
  return { projectId, region };
}

// Mirrors the credential-resolution pattern used by gcp-clients.ts so that all
// GCP API clients in the api-server authenticate as the SA whose key is stored
// in GCP_SERVICE_ACCOUNT_KEY. Without this, GoogleAuth falls back to ambient
// metadata (Replit's compute identity), which has no IAM grants in our project.
export function getGcpCredentials(): { credentials?: any; projectId?: string } {
  const gcpKey = process.env.GCP_SERVICE_ACCOUNT_KEY;
  if (gcpKey) {
    try {
      const parsed = JSON.parse(gcpKey);
      return { credentials: parsed, projectId: parsed.project_id };
    } catch {
      return {};
    }
  }
  return {};
}

export async function triggerCloudRunJob(
  runId: string,
  endpointId: string,
): Promise<{ jobName: string; executionId: string }> {
  const { projectId, region } = getGcpConfig();
  const jobName = process.env.EXTRACTION_JOB_NAME || "extraction-job";

  if (process.env.NODE_ENV === "development") {
    console.log(`[Cloud Run] Would trigger job: ${jobName} for run ${runId} (endpoint: ${endpointId})`);
    return {
      jobName,
      executionId: `dev-exec-${Date.now()}`,
    };
  }

  const { v2 } = await import("@google-cloud/run" as string).catch(() => {
    throw new Error("@google-cloud/run not available. Install it for GCP deployments.");
  });

  const jobsClient = new v2.JobsClient(getGcpCredentials());
  const parent = `projects/${projectId}/locations/${region}/jobs/${jobName}`;

  const [execution] = await jobsClient.runJob({
    name: parent,
    overrides: {
      containerOverrides: [{
        env: [
          { name: "RUN_ID", value: runId },
        ],
      }],
    },
  });

  return {
    jobName,
    executionId: execution.name || `exec-${Date.now()}`,
  };
}

export interface SchedulerJobSpec {
  endpointId: string;
  sourceSystemId: string;
  scheduleCron: string;
  isActive: boolean;
}

export async function syncSchedulerJob(spec: SchedulerJobSpec): Promise<{
  schedulerJobName: string;
  action: "created" | "updated" | "paused" | "resumed" | "deleted";
}> {
  const { projectId, region } = getGcpConfig();
  const schedulerJobName = `extract-${spec.endpointId.replace(/_/g, "-")}`;
  const apiServerUrl = process.env.API_SERVER_URL || `https://api-server-${projectId}.${region}.run.app`;
  const triggerUrl = `${apiServerUrl}/api/scheduler/trigger`;

  if (process.env.NODE_ENV === "development") {
    const action = spec.isActive && spec.scheduleCron ? "created" : "deleted";
    console.log(`[Cloud Scheduler] Would ${action} job: ${schedulerJobName} with cron: ${spec.scheduleCron}`);
    return { schedulerJobName, action };
  }

  const { CloudSchedulerClient } = await import("@google-cloud/scheduler" as string).catch(() => {
    throw new Error("@google-cloud/scheduler not available. Install it for GCP deployments.");
  });

  const client = new CloudSchedulerClient(getGcpCredentials());
  const parent = `projects/${projectId}/locations/${region}`;
  const jobPath = `${parent}/jobs/${schedulerJobName}`;

  if (!spec.isActive || !spec.scheduleCron) {
    try {
      await client.deleteJob({ name: jobPath });
      return { schedulerJobName, action: "deleted" };
    } catch (err: any) {
      if (err.code === 5) {
        return { schedulerJobName, action: "deleted" };
      }
      throw err;
    }
  }

  const jobBody = {
    name: jobPath,
    schedule: spec.scheduleCron,
    timeZone: "UTC",
    httpTarget: {
      uri: triggerUrl,
      httpMethod: "POST" as const,
      body: Buffer.from(JSON.stringify({
        endpointId: spec.endpointId,
        sourceSystemId: spec.sourceSystemId,
      })).toString("base64"),
      headers: { "Content-Type": "application/json" },
      oidcToken: {
        serviceAccountEmail: process.env.SCHEDULER_SERVICE_ACCOUNT || `scheduler-sa@${projectId}.iam.gserviceaccount.com`,
      },
    },
  };

  try {
    await client.getJob({ name: jobPath });
    await client.updateJob({ job: jobBody });
    return { schedulerJobName, action: "updated" };
  } catch (err: any) {
    if (err.code === 5) {
      await client.createJob({ parent, job: jobBody });
      return { schedulerJobName, action: "created" };
    }
    throw err;
  }
}

export interface SimpleSchedulerJobSpec {
  jobName: string;
  schedule: string;
  timeZone: string;
  path: string;
  body?: Record<string, unknown>;
}

export async function syncSimpleSchedulerJob(spec: SimpleSchedulerJobSpec): Promise<{
  schedulerJobName: string;
  action: "created" | "updated" | "skipped-dev";
}> {
  const { projectId, region } = getGcpConfig();
  const apiServerUrl = process.env.API_SERVER_URL || `https://api-server-${projectId}.${region}.run.app`;
  const triggerUrl = `${apiServerUrl}${spec.path}`;

  if (process.env.NODE_ENV === "development") {
    console.log(`[Cloud Scheduler] (dev) Would sync job: ${spec.jobName} schedule="${spec.schedule}" tz=${spec.timeZone} → ${triggerUrl}`);
    return { schedulerJobName: spec.jobName, action: "skipped-dev" };
  }

  const { CloudSchedulerClient } = await import("@google-cloud/scheduler" as string).catch(() => {
    throw new Error("@google-cloud/scheduler not available. Install it for GCP deployments.");
  });

  const client = new CloudSchedulerClient(getGcpCredentials());
  const parent = `projects/${projectId}/locations/${region}`;
  const jobPath = `${parent}/jobs/${spec.jobName}`;

  const jobBody = {
    name: jobPath,
    schedule: spec.schedule,
    timeZone: spec.timeZone,
    httpTarget: {
      uri: triggerUrl,
      httpMethod: "POST" as const,
      body: Buffer.from(JSON.stringify(spec.body ?? {})).toString("base64"),
      headers: { "Content-Type": "application/json" },
      oidcToken: {
        serviceAccountEmail: process.env.SCHEDULER_SERVICE_ACCOUNT || `scheduler-sa@${projectId}.iam.gserviceaccount.com`,
      },
    },
  };

  try {
    await client.getJob({ name: jobPath });
    await client.updateJob({ job: jobBody });
    return { schedulerJobName: spec.jobName, action: "updated" };
  } catch (err: any) {
    if (err.code === 5) {
      try {
        await client.createJob({ parent, job: jobBody });
        return { schedulerJobName: spec.jobName, action: "created" };
      } catch (createErr: any) {
        if (createErr.code === 7) {
          throw new Error(
            `[Cloud Scheduler] Cannot create job "${spec.jobName}" — runtime SA lacks roles/cloudscheduler.admin (and possibly roles/iam.serviceAccountUser on ${jobBody.httpTarget.oidcToken.serviceAccountEmail}). Apply infra/main.tf or grant manually. Underlying error: ${createErr.message}`,
          );
        }
        throw createErr;
      }
    }
    if (err.code === 7) {
      // PERMISSION_DENIED is ambiguous: either the job doesn't exist and the SA
      // can't see it, or the job exists but the SA can't manage it. Either way,
      // the SA needs roles/cloudscheduler.admin so the bootstrap can recover.
      throw new Error(
        `[Cloud Scheduler] PERMISSION_DENIED on getJob("${jobPath}") — runtime SA lacks roles/cloudscheduler.admin on the project. Without it, the daily job will never be created or updated. Apply infra/main.tf (api_server_scheduler_admin / api_controller_hub_dev_scheduler_admin) or grant the role manually. Underlying error: ${err.message}`,
      );
    }
    throw err;
  }
}

export async function syncAllSchedules(): Promise<Array<{
  endpointId: string;
  schedulerJobName: string;
  action: string;
}>> {
  const endpoints = await db
    .select({
      endpointId: endpointDefinitionTable.endpointId,
      sourceSystemId: endpointDefinitionTable.sourceSystemId,
      scheduleCron: endpointDefinitionTable.scheduleCron,
      isActive: endpointDefinitionTable.isActive,
    })
    .from(endpointDefinitionTable);

  const results = [];
  for (const ep of endpoints) {
    if (!ep.scheduleCron && ep.isActive) continue;
    const result = await syncSchedulerJob({
      endpointId: ep.endpointId,
      sourceSystemId: ep.sourceSystemId,
      scheduleCron: ep.scheduleCron ?? "",
      isActive: ep.isActive,
    });
    results.push({ endpointId: ep.endpointId, ...result });
  }

  return results;
}
