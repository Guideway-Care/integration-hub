import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sourceSystemTable = pgTable("source_system", {
  sourceSystemId: text("source_system_id").primaryKey(),
  sourceSystemName: text("source_system_name").notNull(),
  baseUrl: text("base_url").notNull(),
  authType: text("auth_type").notNull(),
  secretManagerSecretName: text("secret_manager_secret_name"),
  serviceAccountEmail: text("service_account_email"),
  isActive: boolean("is_active").notNull().default(true),
  createdTs: timestamp("created_ts", { withTimezone: true }).notNull().defaultNow(),
  updatedTs: timestamp("updated_ts", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSourceSystemSchema = createInsertSchema(sourceSystemTable).omit({
  createdTs: true,
  updatedTs: true,
});

export const selectSourceSystemSchema = createSelectSchema(sourceSystemTable);

export type InsertSourceSystem = z.infer<typeof insertSourceSystemSchema>;
export type SourceSystem = typeof sourceSystemTable.$inferSelect;
