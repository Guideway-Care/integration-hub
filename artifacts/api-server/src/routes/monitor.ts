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
        DATE(JSON_VALUE(contact, '$.contactStartDate')) AS contact_date,
        EXTRACT(DAYOFWEEK FROM DATE(JSON_VALUE(contact, '$.contactStartDate'))) AS dow,
        COUNT(*) AS contact_count
      FROM \`${projectId}.raw.api_payload\`,
        UNNEST(JSON_QUERY_ARRAY(response_body_json, '$.contacts')) AS contact
      WHERE page_status = 'SUCCESS'
        AND source_system_id = 'nice-cxone'
        AND endpoint_id = 'nice-cxone-contacts'
        AND DATE(JSON_VALUE(contact, '$.contactStartDate')) >= @startDate
      GROUP BY contact_date, dow
      ORDER BY contact_date
    `;

    const [rows] = await bq.query({
      query,
      params: { startDate },
      location: "us-central1",
    });

    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

export default router;
