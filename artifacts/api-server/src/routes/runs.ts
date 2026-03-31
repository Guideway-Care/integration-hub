import { Router, type IRouter } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import {
  extractionRunTable,
  extractionEventTable,
  endpointDefinitionTable,
  endpointParameterTable,
  sourceSystemTable,
} from "@workspace/db/schema";
import { TriggerRunSchema } from "@workspace/api-zod";
import { AppError } from "../middlewares/error-handler";

const router: IRouter = Router();

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

async function triggerExtractionJob(runId: string): Promise<string | null> {
  try {
    const token = await getAccessToken();
    const url = `https://${GCP_REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${GCP_PROJECT_ID}/jobs/${EXTRACTION_JOB_NAME}:run`;

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        overrides: {
          containerOverrides: [{
            env: [{ name: "RUN_ID", value: runId }],
          }],
        },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`[Trigger] Failed to trigger extraction job: ${resp.status} ${text}`);
      return null;
    }

    const data = await resp.json() as { metadata?: { name?: string } };
    const executionName = data.metadata?.name ?? null;
    console.log(`[Trigger] Extraction job triggered for run ${runId}, execution: ${executionName}`);
    return executionName;
  } catch (err) {
    console.error("[Trigger] Error triggering extraction job:", err);
    return null;
  }
}

async function acquireLockAndInsert(
  endpointId: string,
  values: typeof extractionRunTable.$inferInsert,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const lockResult = await client.query(
      `SELECT run_id, status FROM extraction_run
       WHERE endpoint_id = $1 AND status IN ('PENDING', 'RUNNING')
       FOR UPDATE`,
      [endpointId],
    );

    if (lockResult.rows.length > 0) {
      await client.query("ROLLBACK");
      throw new AppError(
        409,
        `Active run exists for endpoint '${endpointId}'`,
        { activeRunId: lockResult.rows[0].run_id, status: lockResult.rows[0].status },
      );
    }

    const [created] = await db.insert(extractionRunTable).values(values).returning();

    await client.query("COMMIT");
    return created;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

router.post("/runs", async (req, res, next) => {
  try {
    const body = TriggerRunSchema.parse(req.body);

    const [endpoint] = await db
      .select()
      .from(endpointDefinitionTable)
      .where(eq(endpointDefinitionTable.endpointId, body.endpointId));
    if (!endpoint) {
      throw new AppError(404, `Endpoint '${body.endpointId}' not found`);
    }

    const created = await acquireLockAndInsert(body.endpointId, {
      sourceSystemId: body.sourceSystemId,
      endpointId: body.endpointId,
      runType: body.runType ?? "MANUAL",
      requestedBy: body.requestedBy ?? null,
      windowStartTs: body.windowStartTs ? new Date(body.windowStartTs) : null,
      windowEndTs: body.windowEndTs ? new Date(body.windowEndTs) : null,
      parentRunId: body.parentRunId ?? null,
      status: "PENDING",
    });

    const executionName = await triggerExtractionJob(created.runId);
    if (executionName) {
      await db
        .update(extractionRunTable)
        .set({ cloudRunJobName: EXTRACTION_JOB_NAME, cloudRunExecutionId: executionName })
        .where(eq(extractionRunTable.runId, created.runId));
    }

    res.status(201).json({ data: { ...created, cloudRunExecutionId: executionName } });
  } catch (err) {
    next(err);
  }
});

router.get("/runs", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const endpointId = req.query.endpoint_id as string | undefined;
    const status = req.query.status as string | undefined;
    const sourceSystemId = req.query.source_system_id as string | undefined;

    const conditions = [];
    if (endpointId) conditions.push(eq(extractionRunTable.endpointId, endpointId));
    if (status) conditions.push(eq(extractionRunTable.status, status));
    if (sourceSystemId) conditions.push(eq(extractionRunTable.sourceSystemId, sourceSystemId));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [runs, countResult] = await Promise.all([
      db
        .select()
        .from(extractionRunTable)
        .where(where)
        .orderBy(desc(extractionRunTable.createdTs))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(extractionRunTable)
        .where(where),
    ]);

    res.json({
      data: runs,
      meta: { total: countResult[0].count, limit, offset },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/runs/:id", async (req, res, next) => {
  try {
    const [run] = await db
      .select()
      .from(extractionRunTable)
      .where(eq(extractionRunTable.runId, req.params.id));
    if (!run) {
      throw new AppError(404, `Run '${req.params.id}' not found`);
    }

    const events = await db
      .select()
      .from(extractionEventTable)
      .where(eq(extractionEventTable.runId, req.params.id))
      .orderBy(desc(extractionEventTable.eventTs))
      .limit(100);

    res.json({ data: { ...run, events } });
  } catch (err) {
    next(err);
  }
});

router.get("/runs/:id/events", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;

    const events = await db
      .select()
      .from(extractionEventTable)
      .where(eq(extractionEventTable.runId, req.params.id))
      .orderBy(desc(extractionEventTable.eventTs))
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(extractionEventTable)
      .where(eq(extractionEventTable.runId, req.params.id));

    res.json({
      data: events,
      meta: { total: countResult.count, limit, offset },
    });
  } catch (err) {
    next(err);
  }
});

router.patch("/runs/:id/cancel", async (req, res, next) => {
  try {
    const [run] = await db
      .select()
      .from(extractionRunTable)
      .where(eq(extractionRunTable.runId, req.params.id));

    if (!run) {
      throw new AppError(404, `Run '${req.params.id}' not found`);
    }

    if (!["PENDING", "RUNNING"].includes(run.status)) {
      throw new AppError(400, `Cannot cancel run in '${run.status}' status`);
    }

    const [updated] = await db
      .update(extractionRunTable)
      .set({ status: "CANCELLED", endedTs: new Date() })
      .where(eq(extractionRunTable.runId, req.params.id))
      .returning();

    await db.insert(extractionEventTable).values({
      runId: req.params.id,
      eventType: "RUN_FAILED",
      severity: "WARN",
      message: "Run cancelled by operator",
    });

    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

router.post("/runs/:id/replay", async (req, res, next) => {
  try {
    const [originalRun] = await db
      .select()
      .from(extractionRunTable)
      .where(eq(extractionRunTable.runId, req.params.id));

    if (!originalRun) {
      throw new AppError(404, `Run '${req.params.id}' not found`);
    }

    if (!["FAILED", "COMPLETED"].includes(originalRun.status)) {
      throw new AppError(400, `Cannot replay run in '${originalRun.status}' status`);
    }

    const created = await acquireLockAndInsert(originalRun.endpointId, {
      sourceSystemId: originalRun.sourceSystemId,
      endpointId: originalRun.endpointId,
      runType: "REPLAY",
      requestedBy: req.body?.requestedBy ?? originalRun.requestedBy,
      windowStartTs: originalRun.windowStartTs,
      windowEndTs: originalRun.windowEndTs,
      parentRunId: originalRun.runId,
      status: "PENDING",
    });

    await db
      .update(extractionRunTable)
      .set({ status: "REPLAYED" })
      .where(eq(extractionRunTable.runId, req.params.id));

    const executionName = await triggerExtractionJob(created.runId);
    if (executionName) {
      await db
        .update(extractionRunTable)
        .set({ cloudRunJobName: EXTRACTION_JOB_NAME, cloudRunExecutionId: executionName })
        .where(eq(extractionRunTable.runId, created.runId));
    }

    res.status(201).json({ data: { ...created, cloudRunExecutionId: executionName } });
  } catch (err) {
    next(err);
  }
});

router.get("/endpoints/:endpointId/preview", async (req, res, next) => {
  try {
    const [endpoint] = await db
      .select()
      .from(endpointDefinitionTable)
      .where(eq(endpointDefinitionTable.endpointId, req.params.endpointId));

    if (!endpoint) {
      throw new AppError(404, `Endpoint '${req.params.endpointId}' not found`);
    }

    const [sourceSystem] = await db
      .select()
      .from(sourceSystemTable)
      .where(eq(sourceSystemTable.sourceSystemId, endpoint.sourceSystemId));

    const parameters = await db
      .select()
      .from(endpointParameterTable)
      .where(eq(endpointParameterTable.endpointId, req.params.endpointId));

    const queryParams: Record<string, string> = {};
    const headerParams: Record<string, string> = {};
    const pathParams: Record<string, string> = {};
    const bodyParams: Record<string, unknown> = {};

    for (const param of parameters) {
      const value =
        (req.query[param.parameterName] as string) ?? param.defaultValue;
      if (!value && param.omitIfBlank) continue;
      if (!value && param.isRequired) {
        throw new AppError(400, `Required parameter '${param.parameterName}' is missing`);
      }
      if (!value) continue;

      switch (param.parameterLocation) {
        case "QUERY":
          queryParams[param.parameterName] = value;
          break;
        case "HEADER":
          headerParams[param.parameterName] = value;
          break;
        case "PATH":
          pathParams[param.parameterName] = value;
          break;
        case "BODY":
          bodyParams[param.parameterName] = value;
          break;
      }
    }

    let resolvedPath = endpoint.relativePath;
    for (const [key, val] of Object.entries(pathParams)) {
      resolvedPath = resolvedPath.replace(`{${key}}`, val);
    }

    const queryString = new URLSearchParams(queryParams).toString();
    const fullUrl = `${sourceSystem!.baseUrl}${resolvedPath}${queryString ? `?${queryString}` : ""}`;

    res.json({
      data: {
        method: endpoint.httpMethod,
        url: fullUrl,
        headers: headerParams,
        body: Object.keys(bodyParams).length > 0 ? bodyParams : undefined,
        paginationStrategy: endpoint.paginationStrategy,
        paginationConfig: endpoint.paginationConfigJson,
        incrementalStrategy: endpoint.incrementalStrategy,
        incrementalConfig: endpoint.incrementalConfigJson,
        rateLimitConfig: endpoint.rateLimitConfigJson,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
