import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { endpointDefinitionTable, endpointParameterTable } from "@workspace/db/schema";
import { CreateEndpointDefinitionSchema, UpdateEndpointDefinitionSchema } from "@workspace/api-zod";
import { AppError } from "../middlewares/error-handler";

const router: IRouter = Router();

router.get("/endpoints", async (req, res, next) => {
  try {
    const sourceSystemId = req.query.source_system_id as string | undefined;
    let query = db.select().from(endpointDefinitionTable);
    if (sourceSystemId) {
      query = query.where(eq(endpointDefinitionTable.sourceSystemId, sourceSystemId)) as typeof query;
    }
    const endpoints = await query;
    res.json({ data: endpoints, meta: { total: endpoints.length, limit: endpoints.length, offset: 0 } });
  } catch (err) {
    next(err);
  }
});

router.get("/endpoints/:id", async (req, res, next) => {
  try {
    const [endpoint] = await db
      .select()
      .from(endpointDefinitionTable)
      .where(eq(endpointDefinitionTable.endpointId, req.params.id));
    if (!endpoint) {
      throw new AppError(404, `Endpoint '${req.params.id}' not found`);
    }
    const parameters = await db
      .select()
      .from(endpointParameterTable)
      .where(eq(endpointParameterTable.endpointId, req.params.id));
    res.json({ data: { ...endpoint, parameters } });
  } catch (err) {
    next(err);
  }
});

router.post("/endpoints", async (req, res, next) => {
  try {
    const body = CreateEndpointDefinitionSchema.parse(req.body);
    const [existing] = await db
      .select()
      .from(endpointDefinitionTable)
      .where(eq(endpointDefinitionTable.endpointId, body.endpointId));
    if (existing) {
      throw new AppError(409, `Endpoint '${body.endpointId}' already exists`);
    }
    const [created] = await db.insert(endpointDefinitionTable).values(body).returning();
    res.status(201).json({ data: created });
  } catch (err) {
    next(err);
  }
});

router.put("/endpoints/:id", async (req, res, next) => {
  try {
    const body = UpdateEndpointDefinitionSchema.parse(req.body);
    const [updated] = await db
      .update(endpointDefinitionTable)
      .set({ ...body, updatedTs: new Date() })
      .where(eq(endpointDefinitionTable.endpointId, req.params.id))
      .returning();
    if (!updated) {
      throw new AppError(404, `Endpoint '${req.params.id}' not found`);
    }
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

router.delete("/endpoints/:id", async (req, res, next) => {
  try {
    const [updated] = await db
      .update(endpointDefinitionTable)
      .set({ isActive: false, updatedTs: new Date() })
      .where(eq(endpointDefinitionTable.endpointId, req.params.id))
      .returning();
    if (!updated) {
      throw new AppError(404, `Endpoint '${req.params.id}' not found`);
    }
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
