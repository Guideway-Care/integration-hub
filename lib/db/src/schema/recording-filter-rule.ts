import { pgTable, text, boolean, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const recordingFilterRuleTable = pgTable("recording_filter_rule", {
  ruleId: uuid("rule_id").primaryKey().defaultRandom(),
  campaignName: text("campaign_name").notNull(),
  dispositionPattern: text("disposition_pattern").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdTs: timestamp("created_ts", { withTimezone: true }).notNull().defaultNow(),
  updatedTs: timestamp("updated_ts", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRecordingFilterRuleSchema = createInsertSchema(recordingFilterRuleTable).omit({
  ruleId: true,
  createdTs: true,
  updatedTs: true,
});

export const updateRecordingFilterRuleSchema = insertRecordingFilterRuleSchema.partial();

export const selectRecordingFilterRuleSchema = createSelectSchema(recordingFilterRuleTable);

export type InsertRecordingFilterRule = z.infer<typeof insertRecordingFilterRuleSchema>;
export type UpdateRecordingFilterRule = z.infer<typeof updateRecordingFilterRuleSchema>;
export type RecordingFilterRule = typeof recordingFilterRuleTable.$inferSelect;
