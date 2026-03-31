import { pgTable, text, timestamp, jsonb, uuid, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { extractionRunTable } from "./extraction-run";

export const extractionEventTable = pgTable("extraction_event", {
  eventId: uuid("event_id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => extractionRunTable.runId),
  eventTs: timestamp("event_ts", { withTimezone: true }).notNull().defaultNow(),
  eventType: text("event_type").notNull(),
  severity: text("severity").notNull(),
  message: text("message"),
  detailsJson: jsonb("details_json"),
}, (table) => [
  index("idx_event_run").on(table.runId, table.eventTs),
  index("idx_event_type").on(table.eventType),
]);

export const insertExtractionEventSchema = createInsertSchema(extractionEventTable).omit({
  eventId: true,
  eventTs: true,
});

export const selectExtractionEventSchema = createSelectSchema(extractionEventTable);

export type InsertExtractionEvent = z.infer<typeof insertExtractionEventSchema>;
export type ExtractionEvent = typeof extractionEventTable.$inferSelect;
