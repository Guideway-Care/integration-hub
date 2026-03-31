const { BigQuery } = require("@google-cloud/bigquery");
const { Storage } = require("@google-cloud/storage");

const projectId = process.env.GCP_PROJECT_ID || "guidewaycare-476802";

async function main() {
  console.log("InContact Call Loader starting...");
  console.log("Project:", projectId);
  console.log("TODO: Implement call loading pipeline");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
