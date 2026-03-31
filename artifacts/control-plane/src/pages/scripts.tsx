import { useState } from "react";
import { FileCode, Copy, Check, ExternalLink } from "lucide-react";

const scripts = [
  {
    id: "create-dataset",
    title: "Create InContact Dataset",
    description: "Creates the incontact dataset in BigQuery",
    sql: `CREATE SCHEMA IF NOT EXISTS \`guidewaycare-476802.incontact\`
OPTIONS (
  location = 'us-central1',
  description = 'InContact call recording data'
);`,
  },
  {
    id: "staging-table",
    title: "Staging Call Queue Table",
    description: "Creates the staging_call_queue table for managing call processing",
    sql: `CREATE TABLE IF NOT EXISTS \`guidewaycare-476802.incontact.staging_call_queue\` (
  id STRING NOT NULL,
  call_id STRING NOT NULL,
  status STRING NOT NULL DEFAULT 'pending',
  error_message STRING,
  batch_id STRING,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  processed_at TIMESTAMP
);`,
  },
  {
    id: "recordings-table",
    title: "Call Recordings Table",
    description: "Creates the call_recordings destination table",
    sql: `CREATE TABLE IF NOT EXISTS \`guidewaycare-476802.incontact.call_recordings\` (
  id STRING NOT NULL,
  contact_id STRING,
  acd_contact_id STRING,
  agent_id STRING,
  agent_name STRING,
  start_date TIMESTAMP,
  end_date TIMESTAMP,
  duration_seconds INT64,
  media_type STRING,
  direction STRING,
  file_name STRING,
  gcs_uri STRING,
  file_size_bytes INT64,
  sentiment STRING,
  categories STRING,
  call_tags STRING,
  raw_json STRING,
  ingestion_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP()
);`,
  },
  {
    id: "calls-view",
    title: "Calls Summary View",
    description: "Creates a view for the contact monitor heatmap",
    sql: `CREATE OR REPLACE VIEW \`guidewaycare-476802.incontact.calls\` AS
SELECT
  id,
  contact_id,
  start_date AS contact_start_date,
  agent_name,
  duration_seconds,
  direction
FROM \`guidewaycare-476802.incontact.call_recordings\`
WHERE start_date IS NOT NULL;`,
  },
  {
    id: "daily-counts",
    title: "Daily Contact Counts Query",
    description: "Query for the daily contact volume heatmap",
    sql: `SELECT
  DATE(contact_start_date) AS contact_date,
  EXTRACT(DAYOFWEEK FROM DATE(contact_start_date)) AS dow,
  COUNT(*) AS contact_count
FROM \`guidewaycare-476802.incontact.calls\`
WHERE DATE(contact_start_date) >= '2026-01-01'
GROUP BY contact_date, dow
ORDER BY contact_date;`,
  },
];

export default function ScriptsPage() {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function copyToClipboard(id: string, sql: string) {
    await navigator.clipboard.writeText(sql);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">BigQuery Scripts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          SQL scripts for setting up and querying BigQuery tables
        </p>
      </div>

      <div className="space-y-4">
        {scripts.map((script) => (
          <div key={script.id} className="border border-border rounded-lg bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div>
                <h3 className="text-sm font-semibold">{script.title}</h3>
                <p className="text-xs text-muted-foreground">{script.description}</p>
              </div>
              <button
                onClick={() => copyToClipboard(script.id, script.sql)}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-border rounded-md hover:bg-muted"
              >
                {copiedId === script.id ? (
                  <>
                    <Check className="w-3 h-3 text-green-600" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" /> Copy
                  </>
                )}
              </button>
            </div>
            <pre className="p-4 text-xs font-mono overflow-x-auto bg-muted/30 whitespace-pre-wrap">
              {script.sql}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
