import { z } from "zod/v4";

export const AuthType = z.enum(["OAUTH2_CLIENT_CREDENTIALS", "API_KEY", "BASIC", "BEARER_TOKEN"]);
export type AuthType = z.infer<typeof AuthType>;

export const HttpMethod = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
export type HttpMethod = z.infer<typeof HttpMethod>;

export const PaginationStrategy = z.enum(["NONE", "PAGE_NUMBER", "OFFSET_LIMIT", "NEXT_TOKEN"]);
export type PaginationStrategy = z.infer<typeof PaginationStrategy>;

export const IncrementalStrategy = z.enum(["FULL_REFRESH", "DATE_WINDOW", "CURSOR", "UNKNOWN"]);
export type IncrementalStrategy = z.infer<typeof IncrementalStrategy>;

export const RunType = z.enum(["MANUAL", "SCHEDULED", "REPLAY"]);
export type RunType = z.infer<typeof RunType>;

export const RunStatus = z.enum([
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "REPLAYED",
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const PageStatus = z.enum(["SUCCESS", "ERROR", "SKIPPED", "REPLAYED"]);
export type PageStatus = z.infer<typeof PageStatus>;

export const EventType = z.enum([
  "RUN_STARTED",
  "PAGE_FETCHED",
  "PAGE_WRITTEN",
  "PAGE_ERROR",
  "RATE_LIMITED",
  "AUTH_REFRESHED",
  "CHECKPOINT_SAVED",
  "RUN_COMPLETED",
  "RUN_FAILED",
]);
export type EventType = z.infer<typeof EventType>;

export const EventSeverity = z.enum(["INFO", "WARN", "ERROR"]);
export type EventSeverity = z.infer<typeof EventSeverity>;

export const ParameterLocation = z.enum(["QUERY", "HEADER", "PATH", "BODY"]);
export type ParameterLocation = z.infer<typeof ParameterLocation>;

export const ParameterDataType = z.enum(["STRING", "INTEGER", "BOOLEAN", "DATE", "DATETIME", "ENUM"]);
export type ParameterDataType = z.infer<typeof ParameterDataType>;

export const BackoffStrategy = z.enum(["EXPONENTIAL", "LINEAR", "FIXED"]);
export type BackoffStrategy = z.infer<typeof BackoffStrategy>;
