import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  actor: text("actor"),
  details: jsonb("details"),
  createdTs: timestamp("created_ts", { withTimezone: true }).notNull().defaultNow(),
});
