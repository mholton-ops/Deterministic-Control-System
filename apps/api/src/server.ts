import { timingSafeEqual } from "node:crypto";

import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { ZodError, z } from "zod";
import { commandSchema, dependencyRefSchema, isoDateTimeSchema, originSchema } from "@dcs/contracts";
import { createDb, createPool } from "@dcs/db";
import {
  buildAnalyticsWorkbenchProjection,
  buildCommandSurfaceProjection,
  buildCustodyProjection,
  buildCustomerVisibilityProjection,
  buildEvidenceExplorerProjection,
  buildFieldIntakeProjection,
  buildFundingControlProjection,
  buildGradingWorkbenchProjection,
  buildLedgerTraceProjection,
  buildOperationsOverviewProjection,
  buildPricingExposureWorkbenchProjection,
  buildQueueExposureProjection,
  buildReconciliationWorkbenchProjection,
  buildReplicationSyncProjection,
  buildSmartLibraryDetailProjection,
  buildSettlementListProjection,
  buildSettlementDrilldownProjection,
  buildSettlementReconstructionProjection,
  buildTraceViewProjection,
  buildTruthGraphEntityProjection,
  buildTransactionHistoryProjection,
  getMaterializedSettlementDrilldownProjection,
  getMaterializedWorkbenchProjection,
  getMaterializedLedgerTrace,
  getMaterializedOperationsOverview,
  getMaterializedQueueExposure,
  rebuildMaterializedProjections,
  runProjectionWorkerOnce,
  searchTruthGraph,
} from "@dcs/projections";
import {
  CommandProcessor,
  ControlledOriginError,
  IdempotencyConflictError,
  processControlledQueueBatch,
  retryControlledTransaction,
} from "@dcs/replication";
import { sql } from "drizzle-orm";

const submitCommandRequestSchema = z.object({
  idempotencyKey: z.string().min(8).max(128),
  origin: originSchema,
  createdAt: isoDateTimeSchema.optional(),
  dependencies: z.array(dependencyRefSchema).default([]),
  command: commandSchema,
});

const projectionModeSchema = z.object({
  mode: z.enum(["live", "materialized"]).optional().default("live"),
});
const traceEntityTypeSchema = z.enum([
  "converter",
  "box",
  "queue",
  "shipment",
  "sample",
  "reconciliation_case",
  "settlement",
  "ledger_entry",
]);
const graphEntityTypeSchema = z.enum([
  "converter",
  "box",
  "queue",
  "shipment",
  "sample",
  "ledger_entry",
  "reconciliation_case",
  "settlement",
]);

export interface BuildServerOptions {
  readonly commandToken?: string;
  readonly allowUnauthenticatedCommands?: boolean;
  readonly allowedOrigins?: readonly string[];
}

function isAuthorized(authorization: string | undefined, expectedToken: string): boolean {
  if (!authorization?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(expectedToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function buildServer(options: BuildServerOptions = {}) {
  const pool = createPool();
  const db = createDb(pool);
  const processor = new CommandProcessor(db);

  const commandToken = options.commandToken ?? process.env.DCS_CONTROL_API_TOKEN;
  const allowUnauthenticatedCommands =
    options.allowUnauthenticatedCommands ?? process.env.DCS_ALLOW_UNAUTHENTICATED_DEMO === "true";
  const allowedOrigins =
    options.allowedOrigins ??
    (process.env.DCS_CORS_ORIGINS ?? "http://127.0.0.1:3012,http://localhost:3012")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

  const app = Fastify({ logger: true, bodyLimit: 1_048_576 });
  void app.register(cors, {
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.includes(origin));
    },
  });
  void app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  app.addHook("onSend", async (_request, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("cache-control", "no-store");
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "invalid_request", issues: error.issues });
    }
    request.log.error({ err: error }, "request failed");
    return reply.code(500).send({ error: "internal_server_error" });
  });

  const requireMutationAuthorization = async (request: FastifyRequest, reply: FastifyReply) => {
    if (allowUnauthenticatedCommands) return;
    if (!commandToken) {
      return reply.code(503).send({ error: "mutation_auth_not_configured" });
    }
    if (!isAuthorized(request.headers.authorization, commandToken)) {
      reply.header("www-authenticate", "Bearer");
      return reply.code(401).send({ error: "unauthorized" });
    }
  };

  app.get("/health", async () => ({ ok: true, service: "dcs-control-api" }));
  app.get("/ready", async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { ok: true, service: "dcs-control-api", database: "reachable" };
    } catch {
      return reply.code(503).send({ ok: false, service: "dcs-control-api", database: "unreachable" });
    }
  });

  app.post("/commands", { preHandler: requireMutationAuthorization }, async (request, reply) => {
    const parsed = submitCommandRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_command_request",
        issues: parsed.error.issues,
      });
    }

    try {
      const result = await processor.process({
        idempotencyKey: parsed.data.idempotencyKey,
        createdAt: parsed.data.createdAt ?? new Date().toISOString(),
        dependencies: parsed.data.dependencies,
        command: parsed.data.command,
        origin: parsed.data.origin,
      });

      return reply.code(200).send(result);
    } catch (error) {
      request.log.error({ err: error }, "command application failed");
      if (error instanceof ControlledOriginError) {
        return reply.code(403).send({ error: error.code, message: error.message });
      }
      if (error instanceof IdempotencyConflictError) {
        return reply.code(409).send({ error: "idempotency_conflict", message: error.message });
      }
      return reply.code(422).send({
        error: "command_application_failed",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
  });

  app.post("/projections/rebuild", { preHandler: requireMutationAuthorization }, async () => {
    return rebuildMaterializedProjections(db);
  });

  app.post("/projections/worker/run-once", { preHandler: requireMutationAuthorization }, async () => {
    return runProjectionWorkerOnce(db);
  });

  app.post("/replication/worker/run-once", { preHandler: requireMutationAuthorization }, async () => {
    return processControlledQueueBatch(db);
  });

  app.post("/replication/:transactionId/retry", { preHandler: requireMutationAuthorization }, async (request) => {
    const params = z.object({ transactionId: z.string().uuid() }).parse(request.params);
    return retryControlledTransaction(db, params.transactionId);
  });

  app.get("/projections/operations-overview", async (request, reply) => {
    const mode = projectionModeSchema.parse(request.query).mode;
    if (mode === "materialized") {
      const projection = await getMaterializedOperationsOverview(db);
      if (!projection) {
        return reply.code(404).send({ error: "projection_not_materialized" });
      }

      return projection;
    }

    return buildOperationsOverviewProjection(db);
  });

  app.get("/graph/command-surface", async () => {
    return buildCommandSurfaceProjection(db);
  });

  app.get("/customer/visibility", async () => {
    return buildCustomerVisibilityProjection(db);
  });

  app.get("/workbench/replication-sync", async () => {
    return buildReplicationSyncProjection(db);
  });

  app.get("/workbench/smart-library-detail", async () => {
    return buildSmartLibraryDetailProjection(db);
  });

  app.get("/workbench/funding-control", async () => {
    return buildFundingControlProjection(db);
  });

  app.get("/graph/search", async (request) => {
    const query = z
      .object({
        q: z.string().min(1),
        limit: z.coerce.number().int().min(1).max(100).optional().default(20),
      })
      .parse(request.query);
    return searchTruthGraph(db, query.q, query.limit);
  });

  app.get("/graph/entity/:entityType/:entityId", async (request, reply) => {
    const params = z
      .object({
        entityType: graphEntityTypeSchema,
        entityId: z.string().min(1),
      })
      .parse(request.params);
    const projection = await buildTruthGraphEntityProjection(db, params.entityType, params.entityId);
    if (!projection) {
      return reply.code(404).send({
        error: "graph_entity_not_found",
        message: `No entity projection resolved for ${params.entityType}:${params.entityId}`,
      });
    }
    return projection;
  });

  app.get("/projections/queue-exposure", async (request) => {
    const mode = projectionModeSchema.parse(request.query).mode;
    if (mode === "materialized") {
      return getMaterializedQueueExposure(db);
    }

    return buildQueueExposureProjection(db);
  });

  app.get("/projections/ledger-trace", async (request) => {
    const query = z
      .object({
        sourceOperationalRef: z.string().optional(),
        mode: z.enum(["live", "materialized"]).optional().default("live"),
      })
      .parse(request.query);

    if (query.mode === "materialized") {
      return getMaterializedLedgerTrace(db, query.sourceOperationalRef);
    }

    return buildLedgerTraceProjection(db, query.sourceOperationalRef);
  });

  app.get("/projections/settlement/:settlementId", async (request, reply) => {
    const params = request.params as { settlementId: string };
    const mode = projectionModeSchema.parse(request.query).mode;
    const projection =
      mode === "materialized"
        ? await getMaterializedSettlementDrilldownProjection(db, params.settlementId)
        : await buildSettlementDrilldownProjection(db, params.settlementId);
    if (!projection) {
      return reply.code(404).send({ error: "settlement_not_found" });
    }

    return projection;
  });

  app.get("/trace/:entityType/:entityId", async (request, reply) => {
    const params = z
      .object({
        entityType: traceEntityTypeSchema,
        entityId: z.string().min(1),
      })
      .parse(request.params);

    const trace = await buildTraceViewProjection(db, params.entityType, params.entityId);
    if (trace.steps.length === 0) {
      return reply.code(404).send({
        error: "trace_not_found",
        message: `No trace steps resolved for ${params.entityType}:${params.entityId}`,
      });
    }

    return trace;
  });

  app.get("/reconstruct/settlement/:settlementId", async (request, reply) => {
    const params = z.object({ settlementId: z.string().min(1) }).parse(request.params);
    const reconstruction = await buildSettlementReconstructionProjection(db, params.settlementId);
    if (!reconstruction) {
      return reply.code(404).send({ error: "settlement_not_found" });
    }

    return reconstruction;
  });

  app.get("/workbench/intake", async (request, reply) => {
    const mode = projectionModeSchema.parse(request.query).mode;
    if (mode === "materialized") {
      const projection = await getMaterializedWorkbenchProjection<Awaited<ReturnType<typeof buildFieldIntakeProjection>>>(
        db,
        "intake",
      );
      if (!projection) {
        return reply.code(404).send({ error: "projection_not_materialized" });
      }

      return projection;
    }

    return buildFieldIntakeProjection(db);
  });

  app.get("/workbench/custody", async (request, reply) => {
    const mode = projectionModeSchema.parse(request.query).mode;
    if (mode === "materialized") {
      const projection = await getMaterializedWorkbenchProjection<Awaited<ReturnType<typeof buildCustodyProjection>>>(
        db,
        "custody",
      );
      if (!projection) {
        return reply.code(404).send({ error: "projection_not_materialized" });
      }

      return projection;
    }

    return buildCustodyProjection(db);
  });

  app.get("/workbench/grading", async (request, reply) => {
    const mode = projectionModeSchema.parse(request.query).mode;
    if (mode === "materialized") {
      const projection = await getMaterializedWorkbenchProjection<
        Awaited<ReturnType<typeof buildGradingWorkbenchProjection>>
      >(db, "grading");
      if (!projection) {
        return reply.code(404).send({ error: "projection_not_materialized" });
      }

      return projection;
    }

    return buildGradingWorkbenchProjection(db);
  });

  app.get("/workbench/analytics", async (request, reply) => {
    const mode = projectionModeSchema.parse(request.query).mode;
    if (mode === "materialized") {
      const projection = await getMaterializedWorkbenchProjection<
        Awaited<ReturnType<typeof buildAnalyticsWorkbenchProjection>>
      >(db, "analytics");
      if (!projection) {
        return reply.code(404).send({ error: "projection_not_materialized" });
      }

      return projection;
    }

    return buildAnalyticsWorkbenchProjection(db);
  });

  app.get("/workbench/pricing-exposure", async (request, reply) => {
    const mode = projectionModeSchema.parse(request.query).mode;
    if (mode === "materialized") {
      const projection = await getMaterializedWorkbenchProjection<
        Awaited<ReturnType<typeof buildPricingExposureWorkbenchProjection>>
      >(db, "pricing_exposure");
      if (!projection) {
        return reply.code(404).send({ error: "projection_not_materialized" });
      }

      return projection;
    }

    return buildPricingExposureWorkbenchProjection(db);
  });

  app.get("/workbench/reconciliation", async (request, reply) => {
    const mode = projectionModeSchema.parse(request.query).mode;
    if (mode === "materialized") {
      const projection = await getMaterializedWorkbenchProjection<
        Awaited<ReturnType<typeof buildReconciliationWorkbenchProjection>>
      >(db, "reconciliation");
      if (!projection) {
        return reply.code(404).send({ error: "projection_not_materialized" });
      }

      return projection;
    }

    return buildReconciliationWorkbenchProjection(db);
  });

  app.get("/workbench/settlements", async (request, reply) => {
    const mode = projectionModeSchema.parse(request.query).mode;
    if (mode === "materialized") {
      const projection = await getMaterializedWorkbenchProjection<
        Awaited<ReturnType<typeof buildSettlementListProjection>>
      >(db, "settlements");
      if (!projection) {
        return reply.code(404).send({ error: "projection_not_materialized" });
      }

      return projection;
    }

    return buildSettlementListProjection(db);
  });

  app.get("/workbench/evidence", async (request, reply) => {
    const mode = projectionModeSchema.parse(request.query).mode;
    if (mode === "materialized") {
      const projection = await getMaterializedWorkbenchProjection<
        Awaited<ReturnType<typeof buildEvidenceExplorerProjection>>
      >(db, "evidence");
      if (!projection) {
        return reply.code(404).send({ error: "projection_not_materialized" });
      }

      return projection;
    }

    return buildEvidenceExplorerProjection(db);
  });

  app.get("/workbench/transactions", async (request, reply) => {
    const query = z
      .object({
        mode: z.enum(["live", "materialized"]).optional().default("live"),
        limit: z.coerce.number().int().min(1).max(500).optional().default(100),
      })
      .parse(request.query);

    if (query.mode === "materialized") {
      const projection = await getMaterializedWorkbenchProjection<
        Awaited<ReturnType<typeof buildTransactionHistoryProjection>>
      >(db, "transactions");
      if (!projection) {
        return reply.code(404).send({ error: "projection_not_materialized" });
      }

      return projection.slice(0, query.limit);
    }

    return buildTransactionHistoryProjection(db, query.limit);
  });

  app.addHook("onClose", async () => {
    await pool.end();
  });

  return app;
}
