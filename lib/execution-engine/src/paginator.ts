import { RateLimiter, fetchWithRetry } from "./rate-limiter.js";
import type { AuthManager } from "./auth.js";
import type { EventLogger } from "./event-logger.js";

export interface PaginationConfig {
  pageSize?: number;
  pageSizeParam?: string;
  pageNumberParam?: string;
  offsetParam?: string;
  limitParam?: string;
  nextTokenParam?: string;
  nextTokenResponsePath?: string;
  maxPages?: number;
}

export interface PageResult {
  pageNumber: number;
  responseBody: unknown;
  httpStatus: number;
  responseHeaders: Record<string, string>;
  requestUrl: string;
  skip?: number;
  pageToken?: string;
  nextPageToken?: string;
  recordCount: number;
  isLastPage: boolean;
}

export interface PaginateOptions {
  baseUrl: string;
  relativePath: string;
  httpMethod: string;
  queryParams: Record<string, string>;
  headers: Record<string, string>;
  body?: unknown;
  paginationStrategy: string;
  paginationConfig: PaginationConfig | null;
  rateLimitConfig: any;
  authManager?: AuthManager;
  eventLogger?: EventLogger;
  onPage: (page: PageResult) => Promise<void>;
}

function getNestedValue(obj: any, path: string): any {
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function countRecords(body: unknown): number {
  if (Array.isArray(body)) return body.length;
  if (typeof body === "object" && body !== null) {
    const obj = body as Record<string, unknown>;
    for (const key of ["data", "records", "items", "results", "contacts", "completedContacts", "values"]) {
      if (Array.isArray(obj[key])) return (obj[key] as unknown[]).length;
    }
  }
  return 0;
}

export async function paginate(options: PaginateOptions): Promise<{
  totalPages: number;
  totalApiCalls: number;
  errors: number;
}> {
  const rateLimiter = new RateLimiter(options.rateLimitConfig);
  const config = options.paginationConfig ?? {};
  const maxPages = config.maxPages ?? 10000;

  let totalPages = 0;
  let totalApiCalls = 0;
  let errors = 0;

  switch (options.paginationStrategy) {
    case "NONE": {
      totalApiCalls++;
      const result = await executePage(options, rateLimiter, {}, 1);
      if (result) {
        result.isLastPage = true;
        await options.onPage(result);
        totalPages = 1;
      } else {
        errors++;
      }
      break;
    }

    case "PAGE_NUMBER": {
      const pageParam = config.pageNumberParam ?? "page";
      const sizeParam = config.pageSizeParam ?? "pageSize";
      const pageSize = config.pageSize ?? 100;
      let page = 1;

      while (page <= maxPages) {
        const extraParams: Record<string, string> = {
          [pageParam]: String(page),
          [sizeParam]: String(pageSize),
        };
        totalApiCalls++;
        const result = await executePage(options, rateLimiter, extraParams, page);

        if (!result) {
          errors++;
          await options.eventLogger?.error("PAGE_ERROR", `Page ${page} failed (non-OK response)`, { pageNumber: page });
          break;
        }

        const recordCount = result.recordCount;
        result.isLastPage = recordCount < pageSize || recordCount === 0;
        await options.onPage(result);
        totalPages++;

        if (result.isLastPage) break;
        page++;
      }
      break;
    }

    case "OFFSET_LIMIT": {
      const offsetParam = config.offsetParam ?? "skip";
      const limitParam = config.limitParam ?? "top";
      const pageSize = config.pageSize ?? 5000;
      let skip = 0;
      let pageNumber = 1;

      while (pageNumber <= maxPages) {
        const extraParams: Record<string, string> = {
          [offsetParam]: String(skip),
          [limitParam]: String(pageSize),
        };
        totalApiCalls++;
        const result = await executePage(options, rateLimiter, extraParams, pageNumber);

        if (!result) {
          errors++;
          await options.eventLogger?.error("PAGE_ERROR", `Page ${pageNumber} (skip=${skip}) failed`, { pageNumber, skip });
          break;
        }

        result.skip = skip;
        const recordCount = result.recordCount;
        result.isLastPage = recordCount < pageSize || recordCount === 0;
        await options.onPage(result);
        totalPages++;

        if (result.isLastPage) break;
        skip += pageSize;
        pageNumber++;
      }
      break;
    }

    case "NEXT_TOKEN": {
      const tokenParam = config.nextTokenParam ?? "pageToken";
      const tokenPath = config.nextTokenResponsePath ?? "nextPageToken";
      let token: string | undefined;
      let pageNumber = 1;

      while (pageNumber <= maxPages) {
        const extraParams: Record<string, string> = {};
        if (token) extraParams[tokenParam] = token;

        totalApiCalls++;
        const result = await executePage(options, rateLimiter, extraParams, pageNumber);

        if (!result) {
          errors++;
          await options.eventLogger?.error("PAGE_ERROR", `Page ${pageNumber} failed`, { pageNumber, pageToken: token });
          break;
        }

        result.pageToken = token;
        const nextToken = getNestedValue(result.responseBody, tokenPath);
        result.nextPageToken = nextToken ? String(nextToken) : undefined;
        result.isLastPage = !result.nextPageToken;
        await options.onPage(result);
        totalPages++;

        if (result.isLastPage) break;
        token = result.nextPageToken;
        pageNumber++;
      }
      break;
    }

    default:
      throw new Error(`Unsupported pagination strategy: ${options.paginationStrategy}`);
  }

  return { totalPages, totalApiCalls, errors };
}

async function executePage(
  options: PaginateOptions,
  rateLimiter: RateLimiter,
  extraParams: Record<string, string>,
  pageNumber: number,
): Promise<PageResult | null> {
  const url = new URL(options.relativePath, options.baseUrl);
  for (const [k, v] of Object.entries({ ...options.queryParams, ...extraParams })) {
    url.searchParams.set(k, v);
  }

  let authHeaders = options.headers;
  const requestUrl = url.toString();

  if (options.authManager?.isOAuth2()) {
    const freshAuth = await options.authManager.getHeaders(false);
    authHeaders = { ...options.headers, ...freshAuth.headers };
  }

  const buildFetchOptions = (): RequestInit => {
    const fetchOpts: RequestInit = {
      method: options.httpMethod,
      headers: {
        "Accept": "application/json",
        ...authHeaders,
      },
    };

    if (options.body && ["POST", "PUT", "PATCH"].includes(options.httpMethod)) {
      fetchOpts.body = JSON.stringify(options.body);
      (fetchOpts.headers as Record<string, string>)["Content-Type"] = "application/json";
    }

    return fetchOpts;
  };

  try {
    let response = await fetchWithRetry(requestUrl, buildFetchOptions(), rateLimiter);

    if (response.status === 401 && options.authManager?.isOAuth2()) {
      const refreshResult = await options.authManager.getHeaders(true);
      authHeaders = { ...options.headers, ...refreshResult.headers };
      if (refreshResult.refreshed) {
        await options.eventLogger?.info("AUTH_REFRESHED", "OAuth2 token refreshed mid-run after 401");
      }
      response = await fetchWithRetry(requestUrl, buildFetchOptions(), rateLimiter);
    }

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => { responseHeaders[k] = v; });

    let responseBody: unknown;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      responseBody = await response.json();
    } else {
      responseBody = await response.text();
    }

    if (!response.ok) {
      await options.eventLogger?.error("PAGE_ERROR", `API returned ${response.status}`, {
        pageNumber,
        httpStatus: response.status,
        requestUrl,
        responseBody: typeof responseBody === "string" ? responseBody.slice(0, 500) : undefined,
      });
      return null;
    }

    return {
      pageNumber,
      responseBody,
      httpStatus: response.status,
      responseHeaders,
      requestUrl,
      recordCount: countRecords(responseBody),
      isLastPage: false,
    };
  } catch (err) {
    await options.eventLogger?.error("PAGE_ERROR", `Request failed: ${err}`, {
      pageNumber,
      requestUrl,
      error: String(err),
    });
    return null;
  }
}
