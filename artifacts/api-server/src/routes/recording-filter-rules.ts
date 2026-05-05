import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  recordingFilterRuleTable,
  insertRecordingFilterRuleSchema,
  updateRecordingFilterRuleSchema,
} from "@workspace/db/schema";
import { AppError } from "../middlewares/error-handler";
import { logAudit } from "./audit";

const router: IRouter = Router();

router.get("/recording-filter-rules", async (_req, res, next) => {
  try {
    const rules = await db
      .select()
      .from(recordingFilterRuleTable)
      .orderBy(asc(recordingFilterRuleTable.campaignName), asc(recordingFilterRuleTable.dispositionPattern));
    res.json({ data: rules, meta: { total: rules.length } });
  } catch (err) {
    next(err);
  }
});

router.get("/recording-filter-rules/:id", async (req, res, next) => {
  try {
    const [rule] = await db
      .select()
      .from(recordingFilterRuleTable)
      .where(eq(recordingFilterRuleTable.ruleId, req.params.id));
    if (!rule) throw new AppError(404, `Recording filter rule '${req.params.id}' not found`);
    res.json({ data: rule });
  } catch (err) {
    next(err);
  }
});

router.post("/recording-filter-rules", async (req, res, next) => {
  try {
    const body = insertRecordingFilterRuleSchema.parse(req.body);
    const [created] = await db.insert(recordingFilterRuleTable).values(body).returning();
    await logAudit("CREATE", "recording_filter_rule", created.ruleId, undefined, {
      campaignName: body.campaignName,
      dispositionPattern: body.dispositionPattern,
    });
    res.status(201).json({ data: created });
  } catch (err) {
    next(err);
  }
});

router.put("/recording-filter-rules/:id", async (req, res, next) => {
  try {
    const body = updateRecordingFilterRuleSchema.parse(req.body);
    const [updated] = await db
      .update(recordingFilterRuleTable)
      .set({ ...body, updatedTs: new Date() })
      .where(eq(recordingFilterRuleTable.ruleId, req.params.id))
      .returning();
    if (!updated) throw new AppError(404, `Recording filter rule '${req.params.id}' not found`);
    await logAudit("UPDATE", "recording_filter_rule", req.params.id, undefined, body);
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

router.delete("/recording-filter-rules/:id", async (req, res, next) => {
  try {
    const [deleted] = await db
      .delete(recordingFilterRuleTable)
      .where(eq(recordingFilterRuleTable.ruleId, req.params.id))
      .returning();
    if (!deleted) throw new AppError(404, `Recording filter rule '${req.params.id}' not found`);
    await logAudit("DELETE", "recording_filter_rule", req.params.id, undefined, {
      campaignName: deleted.campaignName,
      dispositionPattern: deleted.dispositionPattern,
    });
    res.json({ data: deleted });
  } catch (err) {
    next(err);
  }
});

export default router;
