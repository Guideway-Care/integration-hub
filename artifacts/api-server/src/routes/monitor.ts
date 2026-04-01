import { Router, type IRouter } from "express";
import { getBigQueryClient, getGcpProjectId } from "../services/gcp-clients";

const router: IRouter = Router();

router.get("/monitor/contact-daily-counts", async (req, res, next) => {
  try {
    const startDate = (req.query.startDate as string) || "2026-01-01";
    const endDate = req.query.endDate as string | undefined;
    const projectId = getGcpProjectId();
    const bq = getBigQueryClient("US");

    let dateFilter = "AND DATE(TIMESTAMP_MICROS(contact_start_date)) >= @startDate";
    const params: Record<string, string> = { startDate };
    if (endDate) {
      dateFilter += " AND DATE(TIMESTAMP_MICROS(contact_start_date)) <= @endDate";
      params.endDate = endDate;
    }

    const query = `
      SELECT
        DATE(TIMESTAMP_MICROS(contact_start_date)) AS contact_date,
        EXTRACT(DAYOFWEEK FROM DATE(TIMESTAMP_MICROS(contact_start_date))) AS dow,
        COUNT(*) AS contact_count
      FROM \`${projectId}.incontact.calls\`
      WHERE contact_start_date IS NOT NULL
        ${dateFilter}
      GROUP BY contact_date, dow
      ORDER BY contact_date
    `;

    const [rows] = await bq.query({
      query,
      params,
    });

    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

export default router;
