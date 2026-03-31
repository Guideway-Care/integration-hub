import { pgTable, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sourceSystemTable } from "./source-system";

export const endpointDefinitionTable = pgTable("endpoint_definition", {
  endpointId: text("endpoint_id").primaryKey(),
  sourceSystemId: text("source_system_id")
    .notNull()
    .references(() => sourceSystemTable.sourceSystemId),
  endpointName: text("endpoint_name").notNull(),
  httpMethod: text("http_method").notNull(),
  relativePath: text("relative_path").notNull(),
  requestTemplateJson: jsonb("request_template_json"),
  paginationStrategy: text("pagination_strategy").notNull(),
  paginationConfigJson: jsonb("pagination_config_json"),
  incrementalStrategy: text("incremental_strategy").notNull(),
  incrementalConfigJson: jsonb("incremental_config_json"),
  rateLimitConfigJson: jsonb("rate_limit_config_json"),
  scheduleCron: text("schedule_cron"),
  isActive: boolean("is_active").notNull().default(true),
  createdTs: timestamp("created_ts", { withTimezone: true }).notNull().defaultNow(),
  updatedTs: timestamp("updated_ts", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEndpointDefinitionSchema = createInsertSchema(endpointDefinitionTable).omit({
  createdTs: true,
  updatedTs: true,
});

export const selectEndpointDefinitionSchema = createSelectSchema(endpointDefinitionTable);

export type InsertEndpointDefinition = z.infer<typeof insertEndpointDefinitionSchema>;
export type EndpointDefinition = typeof endpointDefinitionTable.$inferSelect;
