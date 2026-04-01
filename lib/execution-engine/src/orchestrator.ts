import { eq, and } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  extractionRunTable,
  endpointDefinitionTable,
  sourceSystemTable,
  endpointParameterTable,
} from "@workspace/db/schema";
import { AuthManager } from "./auth.js";
import { paginate, type PageResult } from "./paginator.js";
import { BigQueryWriter, buildPayloadRow } from "./bq-writer.js";
import { EventLogger } from "./event-logger.js";

export interface OrchestratorResult {
  runId: string;
  status: "COMPLETED" | "FAILED";
  totalPages: number;
  totalApiCalls: number;
  errorCount: number;
  errorSummary?: string;
}

function substitutePathParams(
  path: string,
  params: Record<string, string>,
): string {
  return path.replace(/\{(\w+)\}/g, (match, name) => {
    const value = params[name];
    if (value === undefined) {
      throw new Error(`Path parameter {${name}} has no value`);
    }
    return encodeURIComponent(value);
  });
}

export async function executeRun(
  db: NodePgDatabase,
  runId: string,
): Promise<OrchestratorResult> {
  const logger = new EventLogger(db, runId);

  const [run] = await db
    .select()
    .from(extractionRunTable)
    .where(eq(extractionRunTable.runId, runId))
    .limit(1);

  if (!run) {
    throw new Error(`Run ${runId} not found`);
  }

  if (run.status !== "PENDING") {
    throw new Error(`Run ${runId} has status ${run.status}, expected PENDING`);
  }

  await db
    .update(extractionRunTable)
    .set({
      status: "RUNNING",
      startedTs: new Date(),
    })
    .where(eq(extractionRunTable.runId, runId));

  await logger.info("RUN_STARTED", `Extraction run ${runId} started`, {
    runType: run.runType,
    endpointId: run.endpointId,
    parentRunId: run.parentRunId,
  });

  try {
    const [endpoint] = await db
      .select()
      .from(endpointDefinitionTable)
      .where(eq(endpointDefinitionTable.endpointId, run.endpointId))
      .limit(1);

    if (!endpoint) {
      throw new Error(`Endpoint ${run.endpointId} not found`);
    }

    const [sourceSystem] = await db
      .select()
      .from(sourceSystemTable)
      .where(eq(sourceSystemTable.sourceSystemId, run.sourceSystemId))
      .limit(1);

    if (!sourceSystem) {
      throw new Error(`Source system ${run.sourceSystemId} not found`);
    }

    const parameters = await db
      .select()
      .from(endpointParameterTable)
      .where(
        and(
          eq(endpointParameterTable.endpointId, endpoint.endpointId),
          eq(endpointParameterTable.isActive, true),
        ),
      );

    const authManager = new AuthManager(
      sourceSystem.authType,
      sourceSystem.secretManagerSecretName,
      sourceSystem.sourceSystemId,
    );
    await authManager.init();

    const initialAuth = await authManager.getHeaders();
    if (initialAuth.refreshed) {
      await logger.info("AUTH_REFRESHED", "OAuth2 token acquired at startup");
    }

    const queryParams: Record<string, string> = {};
    const headerParams: Record<string, string> = {};
    const pathParams: Record<string, string> = {};
    let bodyTemplate: Record<string, unknown> =
      (endpoint.requestTemplateJson as Record<string, unknown>) ?? {};

    for (const param of parameters) {
      let value: string | undefined;

      if (param.parameterName === "startDate" && run.windowStartTs) {
        value = run.windowStartTs.toISOString();
      } else if (param.parameterName === "endDate" && run.windowEndTs) {
        value = run.windowEndTs.toISOString();
      } else if (param.defaultValue) {
        value = param.defaultValue;
      }

      if (!value && param.isRequired) {
        throw new Error(`Required parameter ${param.parameterName} has no value`);
      }

      if (!value) continue;

      switch (param.parameterLocation) {
        case "QUERY":
          queryParams[param.parameterName] = value;
          break;
        case "HEADER":
          headerParams[param.parameterName] = value;
          break;
        case "BODY":
          bodyTemplate[param.parameterName] = value;
          break;
        case "PATH":
          pathParams[param.parameterName] = value;
          break;
      }
    }

    const resolvedPath = substitutePathParams(endpoint.relativePath, pathParams);

    const bqWriter = new BigQueryWriter();
    await bqWriter.init();

    let pagesWritten = 0;
    let pageErrors = 0;

    const isReplay = run.runType === "REPLAY" && run.parentRunId;
    if (isReplay) {
      await logger.info("RUN_STARTED", `Replay mode: retrying from parent run ${run.parentRunId}`);
    }

    const paginationResult = await paginate({
      baseUrl: sourceSystem.baseUrl,
      relativePath: resolvedPath,
      httpMethod: endpoint.httpMethod,
      queryParams,
      headers: { ...initialAuth.headers, ...headerParams },
      body: Object.keys(bodyTemplate).length > 0 ? bodyTemplate : undefined,
      paginationStrategy: endpoint.paginationStrategy,
      paginationConfig: endpoint.paginationConfigJson as any,
      rateLimitConfig: endpoint.rateLimitConfigJson as any,
      authManager,
      eventLogger: logger,
      onPage: async (page: PageResult) => {
        await logger.info("PAGE_FETCHED", `Page ${page.pageNumber} fetched`, {
          pageNumber: page.pageNumber,
          httpStatus: page.httpStatus,
          recordCount: page.recordCount,
          requestUrl: page.requestUrl,
        });

        const pageStatus = isReplay ? "REPLAYED" : "SUCCESS";

        const row = buildPayloadRow({
          runId,
          sourceSystemId: run.sourceSystemId,
          endpointId: run.endpointId,
          pageNumber: page.pageNumber,
          httpStatusCode: page.httpStatus,
          requestUrl: page.requestUrl,
          responseBody: page.responseBody,
          pageStatus,
          recordCount: page.recordCount,
          skip: page.skip,
          pageToken: page.pageToken,
          nextPageToken: page.nextPageToken,
        });

        try {
          await bqWriter.writeRow(row);
          pagesWritten++;
          await logger.info("PAGE_WRITTEN", `Page ${page.pageNumber} written to BigQuery`, {
            pageNumber: page.pageNumber,
            payloadHash: row.payload_hash,
            pageStatus,
          });
        } catch (err) {
          pageErrors++;
          await logger.error("PAGE_ERROR", `Failed to write page ${page.pageNumber}`, {
            pageNumber: page.pageNumber,
            error: String(err),
          });
        }

        await db
          .update(extractionRunTable)
          .set({
            pageCount: pagesWritten,
            apiCallCount: page.pageNumber,
            errorCount: pageErrors,
            lastCheckpointJson: {
              lastPageNumber: page.pageNumber,
              lastSkip: page.skip,
              lastPageToken: page.pageToken,
              pagesWritten,
              timestamp: new Date().toISOString(),
            },
          })
          .where(eq(extractionRunTable.runId, runId));

        await logger.info("CHECKPOINT_SAVED", `Checkpoint saved at page ${page.pageNumber}`);
      },
    });

    await bqWriter.flush();

    const totalErrors = pageErrors + paginationResult.errors;
    const finalStatus = totalErrors > 0
      ? "FAILED"
      : "COMPLETED";

    const errorSummary = totalErrors > 0
      ? `${totalErrors} error(s): ${pageErrors} write failures, ${paginationResult.errors} API failures out of ${paginationResult.totalApiCalls} calls`
      : null;

    await db
      .update(extractionRunTable)
      .set({
        status: finalStatus,
        endedTs: new Date(),
        apiCallCount: paginationResult.totalApiCalls,
        pageCount: pagesWritten,
        errorCount: totalErrors,
        errorSummary,
      })
      .where(eq(extractionRunTable.runId, runId));

    const completionEventType = finalStatus === "COMPLETED" ? "RUN_COMPLETED" as const : "RUN_FAILED" as const;
    await logger.info(
      completionEventType,
      `Run ${finalStatus.toLowerCase()}: ${pagesWritten} pages written, ${paginationResult.totalApiCalls} API calls`,
      {
        totalPages: paginationResult.totalPages,
        totalApiCalls: paginationResult.totalApiCalls,
        pagesWritten,
        errors: totalErrors,
      },
    );

    return {
      runId,
      status: finalStatus,
      totalPages: paginationResult.totalPages,
      totalApiCalls: paginationResult.totalApiCalls,
      errorCount: totalErrors,
      errorSummary: errorSummary ?? undefined,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    await db
      .update(extractionRunTable)
      .set({
        status: "FAILED",
        endedTs: new Date(),
        errorSummary: errorMessage.slice(0, 1000),
      })
      .where(eq(extractionRunTable.runId, runId));

    await logger.error("RUN_FAILED", `Run failed: ${errorMessage}`, {
      error: errorMessage,
      stack: err instanceof Error ? err.stack : undefined,
    });

    return {
      runId,
      status: "FAILED",
      totalPages: 0,
      totalApiCalls: 0,
      errorCount: 1,
      errorSummary: errorMessage,
    };
  }
}
