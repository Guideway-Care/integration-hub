import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  extractionRunTable,
  endpointDefinitionTable,
} from "@workspace/db/schema";
import { AppError } from "../middlewares/error-handler";
import {
  triggerCloudRunJob,
  syncSchedulerJob,
  syncAllSchedules,
} from "../services/cloud-run";

const router: IRouter = Router();

function verifySchedulerToken(req: any): void {
  if (process.env.NODE_ENV === "development") return;

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    throw new AppError(401, "Missing or invalid authorization header");
  }
}

router.post("/scheduler/trigger", async (req, res, next) => {
  try {
    verifySchedulerToken(req);

    const { endpointId, sourceSystemId } = req.body;
    if (!endpointId) {
      throw new AppError(400, "endpointId is required");
    }

    const [endpoint] = await db
      .select()
      .from(endpointDefinitionTable)
      .where(eq(endpointDefinitionTable.endpointId, endpointId));

    if (!endpoint) {
      throw new AppError(404, `Endpoint '${endpointId}' not found`);
    }

    if (!endpoint.isActive) {
      throw new AppError(400, `Endpoint '${endpointId}' is not active`);
    }

    const resolvedSourceSystemId = sourceSystemId || endpoint.sourceSystemId;

    const lastRun = await db
      .select()
      .from(extractionRunTable)
      .where(
        and(
          eq(extractionRunTable.endpointId, endpointId),
          eq(extractionRunTable.status, "COMPLETED"),
        ),
      )
      .orderBy(desc(extractionRunTable.createdTs))
      .limit(1);

    const now = new Date();
    const incrementalConfig = endpoint.incrementalConfigJson as Record<string, unknown> | null;
    const safetyLagMinutes = (incrementalConfig?.safetyLagMinutes as number) ?? 15;

    let windowStartTs: Date | null = null;
    let windowEndTs: Date | null = null;

    if (endpoint.incrementalStrategy === "DATE_WINDOW") {
      windowEndTs = new Date(now.getTime() - safetyLagMinutes * 60 * 1000);
      if (lastRun.length > 0 && lastRun[0].windowEndTs) {
        windowStartTs = lastRun[0].windowEndTs;
      }
    }

    const [created] = await db
      .insert(extractionRunTable)
      .values({
        sourceSystemId: resolvedSourceSystemId,
        endpointId,
        runType: "SCHEDULED",
        requestedBy: "cloud-scheduler",
        windowStartTs,
        windowEndTs,
        status: "PENDING",
      })
      .returning();

    const jobResult = await triggerCloudRunJob(created.runId, endpointId);

    await db
      .update(extractionRunTable)
      .set({
        cloudRunJobName: jobResult.jobName,
        cloudRunExecutionId: jobResult.executionId,
      })
      .where(eq(extractionRunTable.runId, created.runId));

    res.status(201).json({
      data: {
        runId: created.runId,
        ...jobResult,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/scheduler/sync", async (_req, res, next) => {
  try {
    const results = await syncAllSchedules();
    res.json({ data: results });
  } catch (err) {
    next(err);
  }
});

router.post("/scheduler/sync/:endpointId", async (req, res, next) => {
  try {
    const [endpoint] = await db
      .select()
      .from(endpointDefinitionTable)
      .where(eq(endpointDefinitionTable.endpointId, req.params.endpointId));

    if (!endpoint) {
      throw new AppError(404, `Endpoint '${req.params.endpointId}' not found`);
    }

    const result = await syncSchedulerJob({
      endpointId: endpoint.endpointId,
      sourceSystemId: endpoint.sourceSystemId,
      scheduleCron: endpoint.scheduleCron ?? "",
      isActive: endpoint.isActive,
    });

    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

export default router;
