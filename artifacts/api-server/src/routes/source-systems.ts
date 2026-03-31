import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { sourceSystemTable } from "@workspace/db/schema";
import { CreateSourceSystemSchema, UpdateSourceSystemSchema } from "@workspace/api-zod";
import { AppError } from "../middlewares/error-handler";
import { logAudit } from "./audit";

const router: IRouter = Router();

router.get("/source-systems", async (_req, res, next) => {
  try {
    const systems = await db.select().from(sourceSystemTable);
    res.json({ data: systems, meta: { total: systems.length, limit: systems.length, offset: 0 } });
  } catch (err) {
    next(err);
  }
});

router.get("/source-systems/:id", async (req, res, next) => {
  try {
    const [system] = await db
      .select()
      .from(sourceSystemTable)
      .where(eq(sourceSystemTable.sourceSystemId, req.params.id));
    if (!system) {
      throw new AppError(404, `Source system '${req.params.id}' not found`);
    }
    res.json({ data: system });
  } catch (err) {
    next(err);
  }
});

router.post("/source-systems", async (req, res, next) => {
  try {
    const body = CreateSourceSystemSchema.parse(req.body);
    const [existing] = await db
      .select()
      .from(sourceSystemTable)
      .where(eq(sourceSystemTable.sourceSystemId, body.sourceSystemId));
    if (existing) {
      throw new AppError(409, `Source system '${body.sourceSystemId}' already exists`);
    }
    const [created] = await db.insert(sourceSystemTable).values(body).returning();
    await logAudit("CREATE", "source_system", body.sourceSystemId, undefined, { name: body.sourceSystemName });
    res.status(201).json({ data: created });
  } catch (err) {
    next(err);
  }
});

router.put("/source-systems/:id", async (req, res, next) => {
  try {
    const body = UpdateSourceSystemSchema.parse(req.body);
    const [updated] = await db
      .update(sourceSystemTable)
      .set({ ...body, updatedTs: new Date() })
      .where(eq(sourceSystemTable.sourceSystemId, req.params.id))
      .returning();
    if (!updated) {
      throw new AppError(404, `Source system '${req.params.id}' not found`);
    }
    await logAudit("UPDATE", "source_system", req.params.id, undefined, body);
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

router.delete("/source-systems/:id", async (req, res, next) => {
  try {
    const [updated] = await db
      .update(sourceSystemTable)
      .set({ isActive: false, updatedTs: new Date() })
      .where(eq(sourceSystemTable.sourceSystemId, req.params.id))
      .returning();
    if (!updated) {
      throw new AppError(404, `Source system '${req.params.id}' not found`);
    }
    await logAudit("DEACTIVATE", "source_system", req.params.id);
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
