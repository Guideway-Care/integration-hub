import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { executeRun } from "./orchestrator.js";

export { executeRun } from "./orchestrator.js";
export { getAuthHeaders, clearTokenCache } from "./auth.js";
export { paginate } from "./paginator.js";
export { BigQueryWriter, buildPayloadRow } from "./bq-writer.js";
export { EventLogger } from "./event-logger.js";
export { RateLimiter, fetchWithRetry } from "./rate-limiter.js";

async function main() {
  const runId = process.env.RUN_ID;
  if (!runId) {
    console.error("RUN_ID environment variable is required");
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL environment variable is required");
    process.exit(1);
  }

  console.log(`[Extraction Engine] Starting run: ${runId}`);

  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  try {
    const result = await executeRun(db, runId);

    console.log(`[Extraction Engine] Run complete:`, {
      status: result.status,
      totalPages: result.totalPages,
      totalApiCalls: result.totalApiCalls,
      errorCount: result.errorCount,
    });

    if (result.status === "FAILED") {
      console.error(`[Extraction Engine] Run failed: ${result.errorSummary}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`[Extraction Engine] Fatal error:`, err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

const isDirectExecution =
  process.argv[1]?.endsWith("index.mjs") ||
  process.argv[1]?.endsWith("index.ts");

if (isDirectExecution) {
  main();
}
