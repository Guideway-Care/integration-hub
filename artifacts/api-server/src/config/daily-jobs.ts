export interface DailyJobConfig {
  /** Logical name persisted in scheduled_job_run.job_name and used by the UI. */
  jobName: string;
  /** Cloud Scheduler job name (as created in GCP). */
  schedulerJobName: string;
  /** Cron expression (in timeZone). */
  schedule: string;
  timeZone: string;
  /** API path the scheduler POSTs to. */
  path: string;
  /** Short human-friendly cadence label, e.g. "Daily · 6:00 AM CT". */
  humanLabel: string;
  /** What the job does end-to-end. */
  description: string;
}

export const DAILY_JOBS: Record<"agents" | "contacts", DailyJobConfig> = {
  agents: {
    jobName: "agents-daily",
    schedulerJobName: "incontact-agents-daily",
    schedule: "0 6 * * *",
    timeZone: "America/Chicago",
    path: "/api/incontact/agents-daily-job",
    humanLabel: "Daily · 6:00 AM CT",
    description:
      "Extracts yesterday's agent performance from NICE CXone, then transforms it into BigQuery (incontact.agent_activity).",
  },
  contacts: {
    jobName: "contacts-daily",
    schedulerJobName: "incontact-contacts-daily",
    schedule: "30 6 * * *",
    timeZone: "America/Chicago",
    path: "/api/incontact/contacts-daily-job",
    humanLabel: "Daily · 6:30 AM CT",
    description:
      "Extracts yesterday's contacts/calls into BigQuery, then queues and downloads matching call recordings.",
  },
};

export const DAILY_JOBS_LIST: DailyJobConfig[] = [DAILY_JOBS.agents, DAILY_JOBS.contacts];
