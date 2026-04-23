import { BigQuery } from "@google-cloud/bigquery";
import { Storage } from "@google-cloud/storage";

const PROJECT_ID = process.env.GCP_PROJECT_ID || "guidewaycare-476802";
const DATASET = "incontact";
const BUCKET_NAME = "incontact-audio";
const STAGING_TABLE = `${PROJECT_ID}.${DATASET}.staging_call_queue`;
const CALL_LIST_PATH = "call_list/call_list.txt";

const bigquery = new BigQuery({ projectId: PROJECT_ID });
const gcsStorage = new Storage({ projectId: PROJECT_ID });
const bucket = gcsStorage.bucket(BUCKET_NAME);

async function readCallListFromGCS() {
  const file = bucket.file(CALL_LIST_PATH);

  const [exists] = await file.exists();
  if (!exists) {
    console.log(`No file found at gs://${BUCKET_NAME}/${CALL_LIST_PATH}`);
    return [];
  }

  const [contents] = await file.download();
  const text = contents.toString("utf-8");

  const callIds = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d{6,20}$/.test(line));

  const uniqueIds = [...new Set(callIds)];
  const dupCount = callIds.length - uniqueIds.length;
  if (dupCount > 0) {
    console.log(`Deduplicated ${dupCount} repeated call IDs from input file`);
  }

  return uniqueIds;
}

async function getExistingCallIds(callIds) {
  if (callIds.length === 0) return new Set();

  const batchSize = 500;
  const existing = new Set();

  for (let i = 0; i < callIds.length; i += batchSize) {
    const batch = callIds.slice(i, i + batchSize);
    const placeholders = batch.map((_, idx) => `@id_${idx}`).join(", ");
    const params = {};
    batch.forEach((id, idx) => { params[`id_${idx}`] = id; });

    const query = `
      SELECT call_id FROM \`${STAGING_TABLE}\`
      WHERE call_id IN (${placeholders})
    `;
    const [rows] = await bigquery.query({ query, params });
    rows.forEach((r) => existing.add(r.call_id));
  }

  return existing;
}

async function insertCallIds(callIds) {
  const batchId = `loader-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
  const batchSize = 500;
  let inserted = 0;

  for (let i = 0; i < callIds.length; i += batchSize) {
    const batch = callIds.slice(i, i + batchSize);

    const values = batch.map((_, idx) =>
      `(GENERATE_UUID(), @callId_${idx}, 'pending', CURRENT_TIMESTAMP(), @batchId)`
    ).join(",\n      ");

    const params = { batchId };
    batch.forEach((id, idx) => { params[`callId_${idx}`] = id; });

    const query = `
      INSERT INTO \`${STAGING_TABLE}\`
      (id, call_id, status, created_at, batch_id)
      VALUES ${values}
    `;
    await bigquery.query({ query, params });

    inserted += batch.length;
    console.log(`  Inserted ${inserted} / ${callIds.length}...`);
  }

  return { inserted, batchId };
}

async function archiveCallList() {
  const file = bucket.file(CALL_LIST_PATH);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const archivePath = `call_list/archive/call_list_${timestamp}.txt`;

  await file.copy(bucket.file(archivePath));
  await file.delete();

  console.log(`Archived call list to gs://${BUCKET_NAME}/${archivePath}`);
}

async function main() {
  console.log("=== InContact Call List Loader ===");
  console.log(`Source: gs://${BUCKET_NAME}/${CALL_LIST_PATH}`);
  console.log(`Target: ${STAGING_TABLE}`);
  console.log("");

  const callIds = await readCallListFromGCS();
  if (callIds.length === 0) {
    console.log("No valid call IDs found. Exiting.");
    return;
  }
  console.log(`Found ${callIds.length} call IDs in file`);

  const existing = await getExistingCallIds(callIds);
  const newCallIds = callIds.filter((id) => !existing.has(id));
  const skipped = callIds.length - newCallIds.length;

  if (skipped > 0) {
    console.log(`Skipping ${skipped} call IDs already in staging table`);
  }

  if (newCallIds.length === 0) {
    console.log("All call IDs already exist in staging. Nothing to insert.");
    await archiveCallList();
    return;
  }

  console.log(`Inserting ${newCallIds.length} new call IDs...`);
  const { inserted, batchId } = await insertCallIds(newCallIds);

  console.log("");
  console.log("=== Summary ===");
  console.log(`Batch ID:  ${batchId}`);
  console.log(`Total IDs: ${callIds.length}`);
  console.log(`Skipped:   ${skipped}`);
  console.log(`Inserted:  ${inserted}`);

  await archiveCallList();
  console.log("Done.");
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  if (err.errors) {
    console.error("Details:", JSON.stringify(err.errors));
  }
  process.exit(1);
});
