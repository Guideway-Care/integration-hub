import { createHash, randomUUID } from "crypto";
import { BigQuery } from "@google-cloud/bigquery";

export interface ApiPayloadRow {
  raw_payload_id: string;
  run_id: string;
  source_system_id: string;
  endpoint_id: string;
  request_ts: string;
  response_ts: string;
  http_method: string;
  request_url: string;
  http_status_code: number;
  page_number: number;
  page_token: string | null;
  next_page_token: string | null;
  request_params_json: string | null;
  request_body_json: string | null;
  response_body_json: string;
  record_count_hint: number;
  payload_hash: string;
  page_status: string;
  error_message: string | null;
  ingested_ts: string;
}

export function buildPayloadRow(params: {
  runId: string;
  sourceSystemId: string;
  endpointId: string;
  pageNumber: number;
  httpStatusCode: number;
  requestUrl: string;
  responseBody: unknown;
  pageStatus: string;
  recordCount: number;
  httpMethod?: string;
  skip?: number;
  pageToken?: string;
  nextPageToken?: string;
  errorMessage?: string;
}): ApiPayloadRow {
  const responsePayload = typeof params.responseBody === "string"
    ? params.responseBody
    : JSON.stringify(params.responseBody);

  const payloadHash = createHash("sha256").update(responsePayload).digest("hex");
  const now = new Date().toISOString();

  return {
    raw_payload_id: randomUUID(),
    run_id: params.runId,
    source_system_id: params.sourceSystemId,
    endpoint_id: params.endpointId,
    request_ts: now,
    response_ts: now,
    http_method: params.httpMethod ?? "GET",
    request_url: params.requestUrl,
    http_status_code: params.httpStatusCode,
    page_number: params.pageNumber,
    page_token: params.pageToken ?? null,
    next_page_token: params.nextPageToken ?? null,
    request_params_json: null,
    request_body_json: null,
    response_body_json: responsePayload,
    record_count_hint: params.recordCount,
    payload_hash: payloadHash,
    page_status: params.pageStatus,
    error_message: params.errorMessage ?? null,
    ingested_ts: now,
  };
}

export class BigQueryWriter {
  private buffer: ApiPayloadRow[] = [];
  private batchSize: number;
  private client: BigQuery | null = null;
  private tableRef: any = null;
  private maxRetries = 2;

  constructor(batchSize = 1) {
    this.batchSize = batchSize;
  }

  async init(): Promise<void> {
    if (process.env.NODE_ENV === "development") {
      console.log("[BQ Writer] Running in dev mode - writes will be logged but not sent to BigQuery");
      return;
    }

    try {
      this.client = new BigQuery();
      this.tableRef = this.client.dataset("raw").table("api_payload");
    } catch {
      console.warn("[BQ Writer] BigQuery client not available. Writes will be logged only.");
    }
  }

  async writeRow(row: ApiPayloadRow): Promise<void> {
    this.buffer.push(row);
    if (this.buffer.length >= this.batchSize) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const rows = [...this.buffer];

    if (this.tableRef) {
      for (const row of rows) {
        let lastErr: Error | null = null;
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
          try {
            await this.tableRef.insert([row]);
            console.log(`[BQ Writer] Wrote page ${row.page_number} (${row.record_count_hint} records)`);
            break;
          } catch (err: any) {
            lastErr = err;
            if (err.name === "PartialFailureError") {
              const details = JSON.stringify(err.errors?.[0]?.errors || err.errors || err.message);
              console.error(`[BQ Writer] Partial failure for page ${row.page_number} (attempt ${attempt + 1}): ${details}`);
            } else {
              console.error(`[BQ Writer] Error for page ${row.page_number} (attempt ${attempt + 1}): ${err.message}`);
            }
            if (attempt < this.maxRetries) {
              await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
            } else {
              throw lastErr ?? new Error(`BigQuery insert failed for page ${row.page_number} after retries`);
            }
          }
        }
      }
      this.buffer = [];
    } else {
      this.buffer = [];
      console.log(`[BQ Writer] Would write ${rows.length} rows to raw.api_payload`);
      for (const row of rows) {
        console.log(`  page=${row.page_number} status=${row.page_status} records=${row.record_count_hint} hash=${row.payload_hash.slice(0, 12)}...`);
      }
    }
  }
}
