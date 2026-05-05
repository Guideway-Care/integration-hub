import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { errorHandler } from "./middlewares/error-handler";
import { syncSimpleSchedulerJob } from "./services/cloud-run";

void (async () => {
  try {
    const result = await syncSimpleSchedulerJob({
      jobName: "incontact-agents-daily",
      schedule: "0 6 * * *",
      timeZone: "America/Chicago",
      path: "/api/incontact/agents-daily-job",
      body: { trigger: "scheduled" },
    });
    logger.info({ result }, "[startup] Synced incontact-agents-daily Cloud Scheduler job");
  } catch (err: any) {
    logger.warn({ err: err.message }, "[startup] Failed to sync incontact-agents-daily job (non-fatal)");
  }

  try {
    const result = await syncSimpleSchedulerJob({
      jobName: "incontact-contacts-daily",
      schedule: "30 6 * * *",
      timeZone: "America/Chicago",
      path: "/api/incontact/contacts-daily-job",
      body: { trigger: "scheduled" },
    });
    logger.info({ result }, "[startup] Synced incontact-contacts-daily Cloud Scheduler job");
  } catch (err: any) {
    logger.warn({ err: err.message }, "[startup] Failed to sync incontact-contacts-daily job (non-fatal)");
  }
})();

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

app.use(errorHandler);

export default app;
