import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db } from "@workspace/db";
import { endpointParameterTable } from "@workspace/db/schema";
import { CreateEndpointParameterSchema, UpdateEndpointParameterSchema } from "@workspace/api-zod";
import { AppError } from "../middlewares/error-handler";

const router: IRouter = Router();

router.get("/endpoints/:endpointId/parameters", async (req, res, next) => {
  try {
    const parameters = await db
      .select()
      .from(endpointParameterTable)
      .where(eq(endpointParameterTable.endpointId, req.params.endpointId))
      .orderBy(asc(endpointParameterTable.displayOrder));
    res.json({
      data: parameters,
      meta: { total: parameters.length, limit: parameters.length, offset: 0 },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/endpoints/:endpointId/parameters", async (req, res, next) => {
  try {
    const body = CreateEndpointParameterSchema.parse({
      ...req.body,
      endpointId: req.params.endpointId,
    });
    const [created] = await db.insert(endpointParameterTable).values(body).returning();
    res.status(201).json({ data: created });
  } catch (err) {
    if (err instanceof Error && err.message.includes("uq_endpoint_parameter_name")) {
      next(new AppError(409, `Parameter '${req.body.parameterName}' already exists for this endpoint`));
      return;
    }
    next(err);
  }
});

router.put("/parameters/:id", async (req, res, next) => {
  try {
    const body = UpdateEndpointParameterSchema.parse(req.body);
    const [updated] = await db
      .update(endpointParameterTable)
      .set(body)
      .where(eq(endpointParameterTable.endpointParameterId, req.params.id))
      .returning();
    if (!updated) {
      throw new AppError(404, `Parameter '${req.params.id}' not found`);
    }
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

router.delete("/parameters/:id", async (req, res, next) => {
  try {
    const [deleted] = await db
      .delete(endpointParameterTable)
      .where(eq(endpointParameterTable.endpointParameterId, req.params.id))
      .returning();
    if (!deleted) {
      throw new AppError(404, `Parameter '${req.params.id}' not found`);
    }
    res.status(200).json({ data: deleted });
  } catch (err) {
    next(err);
  }
});

export default router;
