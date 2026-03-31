import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { endpointDefinitionTable } from "@workspace/db/schema";

function getGcpConfig(): { projectId: string; region: string } {
  const projectId = process.env.GCP_PROJECT_ID || "guidewaycare-476802";
  const region = process.env.GCP_REGION || "us-central1";
  return { projectId, region };
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

  const jobsClient = new v2.JobsClient();
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

  const client = new CloudSchedulerClient();
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
