export interface RateLimitConfig {
  requestsPerSecond?: number;
  requestsPerMinute?: number;
  backoffStrategy: "EXPONENTIAL" | "LINEAR" | "FIXED";
  initialBackoffMs: number;
  maxBackoffMs: number;
  maxRetries: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  backoffStrategy: "EXPONENTIAL",
  initialBackoffMs: 1000,
  maxBackoffMs: 60000,
  maxRetries: 3,
};

export class RateLimiter {
  private config: RateLimitConfig;
  private lastRequestTime = 0;
  private minIntervalMs: number;

  constructor(config?: Partial<RateLimitConfig> | null) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (this.config.requestsPerSecond) {
      this.minIntervalMs = 1000 / this.config.requestsPerSecond;
    } else if (this.config.requestsPerMinute) {
      this.minIntervalMs = 60000 / this.config.requestsPerMinute;
    } else {
      this.minIntervalMs = 0;
    }
  }

  async waitForSlot(): Promise<void> {
    if (this.minIntervalMs <= 0) return;

    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minIntervalMs) {
      await sleep(this.minIntervalMs - elapsed);
    }
    this.lastRequestTime = Date.now();
  }

  getBackoffMs(attempt: number): number {
    switch (this.config.backoffStrategy) {
      case "EXPONENTIAL":
        return Math.min(
          this.config.initialBackoffMs * Math.pow(2, attempt),
          this.config.maxBackoffMs,
        );
      case "LINEAR":
        return Math.min(
          this.config.initialBackoffMs * (attempt + 1),
          this.config.maxBackoffMs,
        );
      case "FIXED":
        return this.config.initialBackoffMs;
    }
  }

  get maxRetries(): number {
    return this.config.maxRetries;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  rateLimiter: RateLimiter,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= rateLimiter.maxRetries; attempt++) {
    await rateLimiter.waitForSlot();

    try {
      const response = await fetch(url, options);

      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        const waitMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : rateLimiter.getBackoffMs(attempt);
        await sleep(waitMs);
        continue;
      }

      if (response.status >= 500 && attempt < rateLimiter.maxRetries) {
        const waitMs = rateLimiter.getBackoffMs(attempt);
        console.warn(`[Retry] Server error ${response.status}, retrying in ${waitMs}ms (attempt ${attempt + 1}/${rateLimiter.maxRetries})`);
        await sleep(waitMs);
        continue;
      }

      return response;
    } catch (err) {
      lastError = err as Error;
      if (attempt < rateLimiter.maxRetries) {
        await sleep(rateLimiter.getBackoffMs(attempt));
      }
    }
  }

  throw lastError ?? new Error("Request failed after retries");
}
