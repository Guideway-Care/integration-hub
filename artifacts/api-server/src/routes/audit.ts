import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { auditLog } from "@workspace/db/schema";
import { desc, eq, and, gte, sql } from "drizzle-orm";
import { z } from "zod";

const router: IRouter = Router();

export async function logAudit(action: string, entityType: string, entityId?: string, actor?: string, details?: any) {
  try {
    await db.insert(auditLog).values({
      action,
      entityType,
      entityId: entityId ?? null,
      actor: actor ?? null,
      details: details ?? null,
    });
  } catch (err) {
    console.error("[audit] Failed to log:", err);
  }
}

router.get("/audit", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const entityType = req.query.entityType as string | undefined;

    const conditions = [];
    if (entityType) {
      conditions.push(eq(auditLog.entityType, entityType));
    }

    const rows = await db
      .select()
      .from(auditLog)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditLog.createdTs))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    res.json({ data: rows, meta: { total, limit, offset } });
  } catch (err) {
    next(err);
  }
});

export default router;
