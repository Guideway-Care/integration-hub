import { Router, type IRouter } from "express";
import { getBigQueryClient, getGcpProjectId } from "../services/gcp-clients";

const router: IRouter = Router();

const VALID_STATUSES = ["pending", "processing", "downloaded", "failed"];
const VALID_FORMATS = ["csv", "json"];

function safeLimit(raw: unknown): number {
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 1) return 1000;
  return Math.min(Math.floor(num), 10000);
}

function toCsv(rows: Record<string, any>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    const values = headers.map((h) => {
      const val = row[h];
      if (val === null || val === undefined) return "";
      const str = typeof val === "object" ? JSON.stringify(val) : String(val);
      return str.includes(",") || str.includes('"') || str.includes("\n")
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    });
    lines.push(values.join(","));
  }
  return lines.join("\n");
}

router.get("/export/recordings", async (_req, res, next) => {
  try {
    const bq = getBigQueryClient();
    const projectId = getGcpProjectId();
    const limit = safeLimit(_req.query.limit);

    const [rows] = await bq.query({
      query: `SELECT id, contact_id, acd_contact_id, agent_id, agent_name,
              FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', start_date) as start_date,
              FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', end_date) as end_date,
              duration_seconds, media_type, direction, file_name, gcs_uri, file_size_bytes,
              call_tags, FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', ingestion_timestamp) as ingestion_timestamp
              FROM \`${projectId}.incontact.call_recordings\`
              ORDER BY ingestion_timestamp DESC LIMIT @limit`,
      params: { limit },
    });

    const format = String(_req.query.format || "csv");
    if (format === "json") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", "attachment; filename=recordings.json");
      res.json(rows);
      return;
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=recordings.csv");
    res.send(toCsv(rows));
  } catch (err) {
    next(err);
  }
});

router.get("/export/staging-queue", async (req, res, next) => {
  try {
    const bq = getBigQueryClient();
    const projectId = getGcpProjectId();
    const limit = safeLimit(req.query.limit);
    const status = req.query.status as string | undefined;

    if (status && !VALID_STATUSES.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` });
      return;
    }

    const params: Record<string, any> = { limit };
    let whereClause = "";
    if (status) {
      whereClause = "WHERE status = @status";
      params.status = status;
    }

    const [rows] = await bq.query({
      query: `SELECT id, call_id, status, error_message, batch_id,
              FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', created_at) as created_at,
              FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', processed_at) as processed_at
              FROM \`${projectId}.incontact.staging_call_queue\`
              ${whereClause}
              ORDER BY created_at DESC LIMIT @limit`,
      params,
    });

    const format = String(req.query.format || "csv");
    if (format === "json") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", "attachment; filename=staging-queue.json");
      res.json(rows);
      return;
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=staging-queue.csv");
    res.send(toCsv(rows));
  } catch (err) {
    next(err);
  }
});

export default router;
