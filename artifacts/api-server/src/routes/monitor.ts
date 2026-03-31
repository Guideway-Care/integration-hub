import { Router, type IRouter } from "express";
import { getBigQueryClient, getGcpProjectId } from "../services/gcp-clients";

const router: IRouter = Router();

router.get("/monitor/contact-daily-counts", async (req, res, next) => {
  try {
    const startDate = (req.query.startDate as string) || "2026-01-01";
    const projectId = getGcpProjectId();
    const bq = getBigQueryClient();

    const query = `
      SELECT
        DATE(start_date) AS contact_date,
        EXTRACT(DAYOFWEEK FROM DATE(start_date)) AS dow,
        COUNT(*) AS contact_count
      FROM \`${projectId}.incontact.call_recordings\`
      WHERE start_date IS NOT NULL
        AND DATE(start_date) >= @startDate
      GROUP BY contact_date, dow
      ORDER BY contact_date
    `;

    const [rows] = await bq.query({
      query,
      params: { startDate },
    });

    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

export default router;
