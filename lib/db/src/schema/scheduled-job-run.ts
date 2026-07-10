import { pgTable, text, timestamp, integer, jsonb, uuid, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const scheduledJobRunTable = pgTable("scheduled_job_run", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobName: text("job_name").notNull(),
  runDate: text("run_date").notNull(),
  trigger: text("trigger").notNull(),
  status: text("status").notNull(),
  phase: text("phase"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  durationMs: integer("duration_ms"),
  error: text("error"),
  detailJson: jsonb("detail_json"),
  createdTs: timestamp("created_ts", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_scheduled_run_job_created").on(table.jobName, table.createdTs),
  index("idx_scheduled_run_job_date").on(table.jobName, table.runDate),
]);

export const insertScheduledJobRunSchema = createInsertSchema(scheduledJobRunTable).omit({
  id: true,
  createdTs: true,
});

export const selectScheduledJobRunSchema = createSelectSchema(scheduledJobRunTable);

export type InsertScheduledJobRun = z.infer<typeof insertScheduledJobRunSchema>;
export type ScheduledJobRun = typeof scheduledJobRunTable.$inferSelect;
