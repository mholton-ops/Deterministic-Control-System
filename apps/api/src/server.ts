import { createHash } from "node:crypto";

import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { commandSchema, dependencyRefSchema, isoDateTimeSchema, originSchema } from "@dcs/contracts";
import { createDb, createPool, devices, users } from "@dcs/db";
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
import { CommandProcessor } from "@dcs/replication";
import { eq } from "drizzle-orm";

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

function normalizeToUuid(value: string): string {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (uuidRegex.test(value)) {
    return value;
  }

  const hex = createHash("sha1").update(value).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function ensureOriginRecords(db: ReturnType<typeof createDb>, origin: { userId: string; deviceId: string }) {
  const userRows = await db.select().from(users).where(eq(users.userId, origin.userId)).limit(1);
  if (userRows.length === 0) {
    await db.insert(users).values({
      userId: origin.userId,
      externalRef: origin.userId,
      displayName: `User ${origin.userId.slice(0, 8)}`,
      role: "operator",
      active: true,
      createdAt: new Date(),
    });
  }

  const deviceRows = await db.select().from(devices).where(eq(devices.deviceId, origin.deviceId)).limit(1);
  if (deviceRows.length === 0) {
    await db.insert(devices).values({
      deviceId: origin.deviceId,
      externalRef: origin.deviceId,
      assignedUserId: origin.userId,
      active: true,
      createdAt: new Date(),
    });
  }
}

export function buildServer() {
  const pool = createPool();
  const db = createDb(pool);
  const processor = new CommandProcessor(db);

  const app = Fastify({ logger: true });
  void app.register(cors, { origin: true });

  app.get("/health", async () => ({ ok: true, service: "dcs-control-api" }));

  app.post("/commands", async (request, reply) => {
    const parsed = submitCommandRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_command_request",
        issues: parsed.error.issues,
      });
    }

    const normalizedOrigin = {
      ...parsed.data.origin,
      userId: normalizeToUuid(parsed.data.origin.userId),
      deviceId: normalizeToUuid(parsed.data.origin.deviceId),
    };

    await ensureOriginRecords(db, normalizedOrigin);

    try {
      const result = await processor.process({
        idempotencyKey: parsed.data.idempotencyKey,
        createdAt: parsed.data.createdAt ?? new Date().toISOString(),
        dependencies: parsed.data.dependencies,
        command: parsed.data.command,
        origin: normalizedOrigin,
      });

      return reply.code(200).send(result);
    } catch (error) {
      request.log.error({ err: error }, "command application failed");
      return reply.code(422).send({
        error: "command_application_failed",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
  });

  app.post("/projections/rebuild", async () => {
    return rebuildMaterializedProjections(db);
  });

  app.post("/projections/worker/run-once", async () => {
    return runProjectionWorkerOnce(db);
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
