import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { extractionEventTable } from "@workspace/db/schema";

export type EventType =
  | "RUN_STARTED"
  | "PAGE_FETCHED"
  | "PAGE_WRITTEN"
  | "PAGE_ERROR"
  | "RATE_LIMITED"
  | "AUTH_REFRESHED"
  | "CHECKPOINT_SAVED"
  | "RUN_COMPLETED"
  | "RUN_FAILED";

export type EventSeverity = "INFO" | "WARN" | "ERROR";

export class EventLogger {
  constructor(
    private db: NodePgDatabase,
    private runId: string,
  ) {}

  async log(
    eventType: EventType,
    severity: EventSeverity,
    message?: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    await this.db.insert(extractionEventTable).values({
      runId: this.runId,
      eventType,
      severity,
      message: message ?? null,
      detailsJson: details ?? null,
    });
  }

  async info(eventType: EventType, message?: string, details?: Record<string, unknown>): Promise<void> {
    await this.log(eventType, "INFO", message, details);
  }

  async warn(eventType: EventType, message?: string, details?: Record<string, unknown>): Promise<void> {
    await this.log(eventType, "WARN", message, details);
  }

  async error(eventType: EventType, message?: string, details?: Record<string, unknown>): Promise<void> {
    await this.log(eventType, "ERROR", message, details);
  }
}
