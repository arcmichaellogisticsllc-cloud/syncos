import { randomUUID } from "node:crypto";
import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { logStructured } from "./structured-logger";

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction) {
    const correlationId = request.header("x-correlation-id") ?? randomUUID();
    const workflowCorrelationId = request.header("x-workflow-correlation-id") ?? null;
    const eventCorrelationId = request.header("x-event-correlation-id") ?? null;
    const startedAt = Date.now();

    response.setHeader("x-correlation-id", correlationId);
    if (workflowCorrelationId) response.setHeader("x-workflow-correlation-id", workflowCorrelationId);
    if (eventCorrelationId) response.setHeader("x-event-correlation-id", eventCorrelationId);

    logStructured("API", "request_started", {
      correlationId,
      workflowCorrelationId,
      eventCorrelationId,
      method: request.method,
      path: request.path,
    });
    if (workflowCorrelationId) {
      logStructured("Workflow", "workflow_correlation_received", { correlationId, workflowCorrelationId, path: request.path });
    }

    response.on("finish", () => {
      logStructured("API", "request_completed", {
        correlationId,
        workflowCorrelationId,
        eventCorrelationId,
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });

    next();
  }
}
