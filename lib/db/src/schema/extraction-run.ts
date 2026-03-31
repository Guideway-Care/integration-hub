import { pgTable, text, timestamp, integer, jsonb, uuid, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sourceSystemTable } from "./source-system";
import { endpointDefinitionTable } from "./endpoint-definition";

export const extractionRunTable = pgTable("extraction_run", {
  runId: uuid("run_id").primaryKey().defaultRandom(),
  parentRunId: uuid("parent_run_id").references((): any => extractionRunTable.runId),
  sourceSystemId: text("source_system_id")
    .notNull()
    .references(() => sourceSystemTable.sourceSystemId),
  endpointId: text("endpoint_id")
    .notNull()
    .references(() => endpointDefinitionTable.endpointId),
  runType: text("run_type").notNull(),
  requestedBy: text("requested_by"),
  windowStartTs: timestamp("window_start_ts", { withTimezone: true }),
  windowEndTs: timestamp("window_end_ts", { withTimezone: true }),
  status: text("status").notNull(),
  cloudRunJobName: text("cloud_run_job_name"),
  cloudRunExecutionId: text("cloud_run_execution_id"),
  startedTs: timestamp("started_ts", { withTimezone: true }),
  endedTs: timestamp("ended_ts", { withTimezone: true }),
  apiCallCount: integer("api_call_count").notNull().default(0),
  pageCount: integer("page_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  lastCheckpointJson: jsonb("last_checkpoint_json"),
  errorSummary: text("error_summary"),
  createdTs: timestamp("created_ts", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_run_endpoint_status").on(table.endpointId, table.status),
  index("idx_run_source").on(table.sourceSystemId),
  index("idx_run_created").on(table.createdTs),
]);

export const insertExtractionRunSchema = createInsertSchema(extractionRunTable).omit({
  runId: true,
  createdTs: true,
});

export const selectExtractionRunSchema = createSelectSchema(extractionRunTable);

export type InsertExtractionRun = z.infer<typeof insertExtractionRunSchema>;
export type ExtractionRun = typeof extractionRunTable.$inferSelect;
