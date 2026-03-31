import { pgTable, text, boolean, integer, jsonb, unique } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { endpointDefinitionTable } from "./endpoint-definition";

export const endpointParameterTable = pgTable("endpoint_parameter", {
  endpointParameterId: text("endpoint_parameter_id").primaryKey(),
  endpointId: text("endpoint_id")
    .notNull()
    .references(() => endpointDefinitionTable.endpointId),
  parameterName: text("parameter_name").notNull(),
  parameterLabel: text("parameter_label"),
  parameterLocation: text("parameter_location").notNull(),
  dataType: text("data_type").notNull(),
  isRequired: boolean("is_required").notNull().default(false),
  defaultValue: text("default_value"),
  allowedValuesJson: jsonb("allowed_values_json"),
  helpText: text("help_text"),
  omitIfBlank: boolean("omit_if_blank").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
}, (table) => [
  unique("uq_endpoint_parameter_name").on(table.endpointId, table.parameterName),
]);

export const insertEndpointParameterSchema = createInsertSchema(endpointParameterTable);

export const selectEndpointParameterSchema = createSelectSchema(endpointParameterTable);

export type InsertEndpointParameter = z.infer<typeof insertEndpointParameterSchema>;
export type EndpointParameter = typeof endpointParameterTable.$inferSelect;
