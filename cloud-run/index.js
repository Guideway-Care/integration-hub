import { BigQuery } from "@google-cloud/bigquery";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { Storage } from "@google-cloud/storage";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

// Network errors worth retrying once. NICE/S3 occasionally closes long-running
// media downloads mid-stream — most of the time the same pre-signed URL still
// works for a quick second attempt.
const TRANSIENT_NETWORK_CODES = new Set([
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
]);

function isTransientNetworkError(err) {
  if (!err) return false;
  const cause = err.cause || {};
  const codes = [err.code, cause.code, err.name, cause.name, err.message].filter(Boolean);
  if (codes.some((c) => typeof c === "string" && TRANSIENT_NETWORK_CODES.has(c))) return true;
  // undici surfaces aborts as TypeError("terminated") with cause.code='UND_ERR_SOCKET'
  if (err.name === "TypeError" && /terminated|aborted|fetch failed/i.test(err.message || "")) return true;
  return false;
}

async function streamToGcs(responseBody, file) {
  // pipeline() propagates errors from EVERY stage — including the source
  // Readable — so a mid-stream socket abort rejects cleanly instead of
  // crashing the process with an unhandled 'error' event.
  await pipeline(
    Readable.fromWeb(responseBody),
    file.createWriteStream({ contentType: "video/mp4", resumable: false }),
  );
}

const PROJECT_ID = process.env.GCP_PROJECT_ID || "guidewaycare-476802";
const DATASET = "incontact";
const BUCKET_NAME = "incontact-audio";
const STAGING_TABLE = `${PROJECT_ID}.${DATASET}.staging_call_queue`;
const RECORDINGS_TABLE = `${PROJECT_ID}.${DATASET}.call_recordings`;

const VALID_STATUSES = ["pending", "processing", "downloaded", "failed"];
const TOKEN_REFRESH_INTERVAL = 50;
const BATCH_LIMIT = parseInt(process.env.BATCH_LIMIT || "500", 10);

const bigquery = new BigQuery({ projectId: PROJECT_ID });
const gcsStorage = new Storage({ projectId: PROJECT_ID });
const secretManager = new SecretManagerServiceClient();
const bucket = gcsStorage.bucket(BUCKET_NAME);

async function getSecretValue(secretName) {
  const name = `projects/${PROJECT_ID}/secrets/${secretName}/versions/latest`;
  const [version] = await secretManager.accessSecretVersion({ name });
  const value = version.payload?.data?.toString();
  if (!value) throw new Error(`Secret ${secretName} is empty`);
  return value;
}

async function getInContactToken() {
  const accessKeyId = await getSecretValue("inContact-Client-Id");
  const accessKeySecret = await getSecretValue("inContact-Client-Secret");

  const response = await fetch(
    "https://na1.nice-incontact.com/authentication/v1/token/access-key",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessKeyId, accessKeySecret }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Token request failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return {
    token: data.access_token,
    resourceServerBaseUri:
      data.resource_server_base_uri || "https://na1.nice-incontact.com",
  };
}

async function getNextPendingCall() {
  const query = `
    SELECT id, call_id, batch_id
    FROM \`${STAGING_TABLE}\`
    WHERE status = 'pending'
    ORDER BY created_at ASC, id ASC
    LIMIT 1
  `;
  const [rows] = await bigquery.query({ query });
  return rows.length > 0 ? rows[0] : null;
}

async function resetStaleProcessingRows() {
  const query = `
    UPDATE \`${STAGING_TABLE}\`
    SET status = 'pending', error_message = NULL
    WHERE status = 'processing'
      AND TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), created_at, MINUTE) > 30
  `;
  const [, , response] = await bigquery.query({ query });
  const affected = response?.totalRows || 0;
  if (affected > 0) {
    console.log(`Reset ${affected} stale processing rows back to pending`);
  }
}

async function updateStagingStatus(id, status, errorMessage = null) {
  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }

  const params = { id, status };
  let setClause = "status = @status";

  if (status === "downloaded" || status === "failed") {
    setClause += ", processed_at = CURRENT_TIMESTAMP()";
  }

  if (errorMessage) {
    params.errorMessage = errorMessage.substring(0, 1000);
    setClause += ", error_message = @errorMessage";
  }

  const query = `
    UPDATE \`${STAGING_TABLE}\`
    SET ${setClause}
    WHERE id = @id
  `;
  await bigquery.query({ query, params });
}

async function insertCallRecording(record) {
  const query = `
    INSERT INTO \`${RECORDINGS_TABLE}\`
    (id, contact_id, acd_contact_id, agent_id, agent_name, start_date, end_date,
     duration_seconds, media_type, direction, file_name, gcs_uri, file_size_bytes,
     sentiment, categories, call_tags, raw_json, ingestion_timestamp)
    VALUES
    (GENERATE_UUID(), @contact_id, @acd_contact_id, @agent_id, @agent_name,
     @start_date, @end_date, @duration_seconds, @media_type, @direction,
     @file_name, @gcs_uri, @file_size_bytes, @sentiment, @categories,
     @call_tags, @raw_json, CURRENT_TIMESTAMP())
  `;
  const types = {
    contact_id: "STRING",
    acd_contact_id: "STRING",
    agent_id: "STRING",
    agent_name: "STRING",
    start_date: "STRING",
    end_date: "STRING",
    duration_seconds: "INT64",
    media_type: "STRING",
    direction: "STRING",
    file_name: "STRING",
    gcs_uri: "STRING",
    file_size_bytes: "INT64",
    sentiment: "STRING",
    categories: "STRING",
    call_tags: "STRING",
    raw_json: "STRING",
  };
  await bigquery.query({ query, params: record, types });
}

async function processCall(callId, token, resourceServerBaseUri) {
  const url = new URL(`${resourceServerBaseUri}/media-playback/v1/contacts`);
  url.searchParams.set("acd-call-id", callId);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  const apiResponse = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!apiResponse.ok) {
    const errText = await apiResponse.text();
    throw new Error(`API returned ${apiResponse.status}: ${errText}`);
  }

  const data = await apiResponse.json();
  const interaction = data.interactions?.[0];
  const interactionData = interaction?.data;

  const agent = interactionData?.participantDataList?.find(
    (p) => p.participantType === "AGENT"
  );
  const segment = interactionData?.segmentsDataList?.[0];
  const sentiments = interactionData?.sentiments || [];
  const categories = interactionData?.categoryMatchesList || [];
  const callTags = interaction?.callTaggingList || [];

  let durationSeconds = null;
  if (interactionData?.startTime && interactionData?.endTime) {
    durationSeconds = Math.floor(
      (new Date(interactionData.endTime).getTime() -
        new Date(interactionData.startTime).getTime()) /
        1000
    );
  }

  let gcsUri = null;
  let fileSizeBytes = null;
  let fileUrl = interactionData?.fileToPlayUrl;

  if (fileUrl) {
    const fileName = `${callId}.mp4`;
    const file = bucket.file(fileName);

    // Attempt download with up to 2 retries on transient network errors.
    // Attempt 1: same pre-signed URL (usually still valid within seconds).
    // Attempt 2: re-fetch metadata to get a fresh pre-signed URL, then try again.
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const mediaResponse = await fetch(fileUrl);
        if (!mediaResponse.ok || !mediaResponse.body) {
          throw new Error(
            `Failed to download recording: HTTP ${mediaResponse.status}`,
          );
        }
        const contentLength = mediaResponse.headers.get("content-length");
        fileSizeBytes = contentLength ? parseInt(contentLength) : null;
        await streamToGcs(mediaResponse.body, file);
        if (attempt > 1) {
          console.log(`  Download succeeded on attempt ${attempt}`);
        }
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const transient = isTransientNetworkError(err);
        const code = err.code || err.cause?.code || err.name;
        console.warn(
          `  Download attempt ${attempt}/3 failed (${code}): ${err.message}` +
            (transient ? " — will retry" : ""),
        );
        if (!transient || attempt === 3) break;
        // Backoff: 1s, then 3s
        await new Promise((r) => setTimeout(r, attempt === 1 ? 1000 : 3000));
        // On the second retry, refresh the pre-signed URL in case the original expired
        if (attempt === 2) {
          try {
            const refreshed = await fetch(url.toString(), {
              headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
            });
            if (refreshed.ok) {
              const refreshedData = await refreshed.json();
              const refreshedUrl =
                refreshedData.interactions?.[0]?.data?.fileToPlayUrl;
              if (refreshedUrl) {
                console.log("  Refreshed pre-signed URL for final retry");
                fileUrl = refreshedUrl;
              }
            }
          } catch (refreshErr) {
            console.warn(`  URL refresh failed: ${refreshErr.message}`);
          }
        }
      }
    }
    if (lastErr) throw lastErr;

    gcsUri = `gs://${BUCKET_NAME}/${fileName}`;
    console.log(`  Uploaded ${fileName} to GCS`);
  }

  const record = {
    contact_id: data.contactId || "",
    acd_contact_id: data.acdcontactId || callId,
    agent_id: agent?.participantId || null,
    agent_name: agent?.agentName || null,
    start_date: interactionData?.startTime || null,
    end_date: interactionData?.endTime || null,
    duration_seconds: durationSeconds,
    media_type: interaction?.mediaType || null,
    direction: segment?.directionType || null,
    file_name: gcsUri ? `${callId}.mp4` : null,
    gcs_uri: gcsUri,
    file_size_bytes: fileSizeBytes,
    sentiment:
      sentiments.length > 0 ? JSON.stringify(sentiments) : null,
    categories:
      categories.length > 0 ? JSON.stringify(categories) : null,
    call_tags:
      callTags.length > 0
        ? JSON.stringify(callTags.map((t) => t.value))
        : null,
    raw_json: JSON.stringify(data),
  };

  await insertCallRecording(record);
  return record;
}

async function main() {
  console.log("=== InContact Call Processor ===");
  console.log(`Project: ${PROJECT_ID}`);
  console.log(`Dataset: ${DATASET}`);
  console.log(`Bucket:  ${BUCKET_NAME}`);
  console.log(`Batch:   ${BATCH_LIMIT} calls`);
  console.log("");

  await resetStaleProcessingRows();

  const activeQuery = `
    SELECT COUNT(*) as count
    FROM \`${STAGING_TABLE}\`
    WHERE status = 'processing'
  `;
  const [activeRows] = await bigquery.query({ query: activeQuery });
  if (activeRows[0].count > 0) {
    console.log(`Another processor is already running (${activeRows[0].count} rows in 'processing' status). Exiting.`);
    return;
  }

  let auth = await getInContactToken();
  console.log("Authenticated with InContact API");
  console.log("");

  let processedCount = 0;
  let failedCount = 0;
  let callsSinceTokenRefresh = 0;

  while (true) {
    if (processedCount + failedCount >= BATCH_LIMIT) {
      console.log(`Batch limit reached (${BATCH_LIMIT}). Stopping.`);
      break;
    }

    const pending = await getNextPendingCall();
    if (!pending) {
      console.log("No more pending calls. Done.");
      break;
    }

    if (callsSinceTokenRefresh >= TOKEN_REFRESH_INTERVAL) {
      console.log("  Refreshing InContact token...");
      auth = await getInContactToken();
      callsSinceTokenRefresh = 0;
    }

    const { id, call_id: callId } = pending;
    const callNumber = processedCount + failedCount + 1;
    console.log(`Processing call ${callId} (#${callNumber})...`);

    try {
      await updateStagingStatus(id, "processing");
    } catch (err) {
      console.error(`  Failed to mark processing: ${err.message}`);
      failedCount++;
      continue;
    }

    try {
      await processCall(callId, auth.token, auth.resourceServerBaseUri);
      await updateStagingStatus(id, "downloaded");
      processedCount++;
      callsSinceTokenRefresh++;
      console.log(`  Downloaded successfully`);
    } catch (err) {
      failedCount++;
      callsSinceTokenRefresh++;
      const errMsg = err.message || err.toString() || "Unknown error";
      console.error(`  Failed: ${errMsg}`);
      if (err.errors) {
        console.error(`  Details: ${JSON.stringify(err.errors)}`);
      }
      try {
        await updateStagingStatus(id, "failed", errMsg);
      } catch (statusErr) {
        console.error(
          `  Could not update status to failed: ${statusErr.message}`
        );
      }
    }
  }

  console.log("");
  console.log("=== Summary ===");
  console.log(`Downloaded: ${processedCount}`);
  console.log(`Failed:     ${failedCount}`);
  console.log(`Total:      ${processedCount + failedCount}`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  if (err.errors) {
    console.error("Details:", JSON.stringify(err.errors));
  }
  process.exit(1);
});
