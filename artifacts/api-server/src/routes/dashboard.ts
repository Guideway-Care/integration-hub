import { Router, type IRouter } from "express";
import { db, pool } from "@workspace/db";
import { sourceSystemTable, endpointDefinitionTable, extractionRunTable } from "@workspace/db/schema";
import { count, eq, sql, desc, and, gte } from "drizzle-orm";
import { getBigQueryClient, getGcpProjectId } from "../services/gcp-clients";

const router: IRouter = Router();

router.get("/dashboard/summary", async (_req, res, next) => {
  try {
    const projectId = getGcpProjectId();

    const [systemsResult] = await db
      .select({ total: count(), active: count(sql`CASE WHEN ${sourceSystemTable.isActive} THEN 1 END`) })
      .from(sourceSystemTable);

    const [endpointsResult] = await db
      .select({ total: count(), active: count(sql`CASE WHEN ${endpointDefinitionTable.isActive} THEN 1 END`) })
      .from(endpointDefinitionTable);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [runsWeek] = await db
      .select({ total: count() })
      .from(extractionRunTable)
      .where(gte(extractionRunTable.createdTs, new Date(sevenDaysAgo)));

    const [runsTotals] = await db.select({
      total: count(),
      completed: count(sql`CASE WHEN ${extractionRunTable.status} = 'COMPLETED' THEN 1 END`),
      failed: count(sql`CASE WHEN ${extractionRunTable.status} = 'FAILED' THEN 1 END`),
      running: count(sql`CASE WHEN ${extractionRunTable.status} = 'RUNNING' THEN 1 END`),
      pending: count(sql`CASE WHEN ${extractionRunTable.status} = 'PENDING' THEN 1 END`),
    }).from(extractionRunTable);

    const recentRuns = await db
      .select({
        runId: extractionRunTable.runId,
        endpointId: extractionRunTable.endpointId,
        status: extractionRunTable.status,
        apiCallCount: extractionRunTable.apiCallCount,
        errorCount: extractionRunTable.errorCount,
        createdTs: extractionRunTable.createdTs,
      })
      .from(extractionRunTable)
      .orderBy(desc(extractionRunTable.createdTs))
      .limit(5);

    let incontact = { staging: { pending: 0, processing: 0, downloaded: 0, failed: 0, total: 0 }, recordingsCount: 0 };
    try {
      const bq = getBigQueryClient();
      const [stagingRows] = await bq.query({
        query: `SELECT status, COUNT(*) as count FROM \`${projectId}.incontact.staging_call_queue\` GROUP BY status`,
      });
      const summary: { pending: number; processing: number; downloaded: number; failed: number } = { pending: 0, processing: 0, downloaded: 0, failed: 0 };
      stagingRows.forEach((r: any) => { (summary as any)[r.status] = Number(r.count); });
      incontact.staging = { ...summary, total: Object.values(summary).reduce((a, b) => a + b, 0) };

      const [recCount] = await bq.query({
        query: `SELECT COUNT(*) as cnt FROM \`${projectId}.incontact.call_recordings\``,
      });
      incontact.recordingsCount = Number(recCount[0]?.cnt || 0);
    } catch {
    }

    res.json({
      sourceSystems: systemsResult,
      endpoints: endpointsResult,
      runs: {
        ...runsTotals,
        thisWeek: runsWeek?.total || 0,
        recent: recentRuns,
      },
      incontact,
      gcpProject: projectId,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
