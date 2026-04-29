import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 39123;
const BASE_URL = `http://localhost:${PORT}`;
const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const NPM_EXECUTABLE = process.platform === "win32" ? "npm.cmd" : "npm";

interface CommandSubmission {
  readonly idempotencyKey: string;
  readonly origin: {
    sourceSystem: "field_client" | "server" | "operator_console";
    userId: string;
    deviceId: string;
    capturedAt: string;
  };
  readonly createdAt: string;
  readonly dependencies: readonly {
    entityType: string;
    entityId: string;
    requiredState: string;
  }[];
  readonly command: Record<string, unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveCommand(command: string, args: string[]): { executable: string; args: string[] } {
  if (process.platform === "win32") {
    return {
      executable: "cmd.exe",
      args: ["/d", "/s", "/c", `${command} ${args.join(" ")}`],
    };
  }

  return {
    executable: command,
    args,
  };
}

function killProcessTree(pid: number | undefined): void {
  if (!pid) return;

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // no-op
    }
  }
}

async function waitForHealth(timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  let lastError = "unknown";
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) {
        return;
      }

      lastError = `health_status_${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await sleep(300);
  }

  throw new Error(`API did not become healthy within ${timeoutMs}ms: ${lastError}`);
}

async function postCommand(submission: CommandSubmission): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE_URL}/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(submission),
  });

  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`Command failed ${response.status}: ${JSON.stringify(payload)}`);
  }

  assert.equal(payload.status, "applied", `Command ${submission.command.commandType} did not apply.`);
  return payload;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GET ${path} failed ${response.status}: ${body}`);
  }

  return (await response.json()) as T;
}

export async function runApiIntegrationWorkflow(): Promise<void> {
  const apiCommand = resolveCommand(NPM_EXECUTABLE, ["run", "dev:api"]);
  const apiProcess = spawn(apiCommand.executable, apiCommand.args, {
    cwd: ROOT_DIR,
    env: { ...process.env, PORT: String(PORT) },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderrBuffer = "";
  let success = false;
  apiProcess.stderr.on("data", (chunk) => {
    stderrBuffer += chunk.toString();
  });

  try {
    await waitForHealth(20_000);

    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const queueCode = `QUEUE-API-${suffix}`;
    const boxCode = `PC-BOX-API-${suffix}`;
    const shipmentCode = `SHIP-API-${suffix}`;

    const origin = {
      sourceSystem: "operator_console" as const,
      userId: `api-user-${suffix}`,
      deviceId: `api-device-${suffix}`,
      capturedAt: new Date("2026-02-10T10:00:00.000Z").toISOString(),
    };

    await postCommand({
      idempotencyKey: `api-capture-${suffix}`,
      origin,
      createdAt: new Date("2026-02-10T10:00:00.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "field.capture_converter",
        commandId: randomUUID(),
        yardId: "YARD-SIM-01",
        boxId: boxCode,
        vinOrSerial: `VIN-API-${suffix}`,
        capturedAt: new Date("2026-02-10T10:00:00.000Z").toISOString(),
        location: { lat: 34.211, lon: -118.49, accuracyM: 7 },
        evidence: { evidenceBundleId: randomUUID(), requiredTypesPresent: ["image", "gps"] },
      },
    });

    await postCommand({
      idempotencyKey: `api-lock-queue-${suffix}`,
      origin,
      createdAt: new Date("2026-02-10T10:05:00.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "custody.lock_queue_for_processing",
        commandId: randomUUID(),
        queueId: queueCode,
      },
    });

    await postCommand({
      idempotencyKey: `api-assign-box-queue-${suffix}`,
      origin,
      createdAt: new Date("2026-02-10T10:05:30.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "custody.assign_box_to_queue",
        commandId: randomUUID(),
        boxId: boxCode,
        queueId: queueCode,
      },
    });

    await postCommand({
      idempotencyKey: `api-create-shipment-${suffix}`,
      origin,
      createdAt: new Date("2026-02-10T10:06:00.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "custody.create_shipment",
        commandId: randomUUID(),
        shipmentCode,
        originSiteId: "YARD-SIM-01",
        destinationSiteId: "WAREHOUSE-SIM-01",
        boxCodes: [boxCode],
      },
    });

    await postCommand({
      idempotencyKey: `api-receive-shipment-${suffix}`,
      origin,
      createdAt: new Date("2026-02-10T10:08:00.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "custody.receive_shipment",
        commandId: randomUUID(),
        shipmentRef: shipmentCode,
        receivingSiteId: "WAREHOUSE-SIM-01",
      },
    });

    await postCommand({
      idempotencyKey: `api-sample-${suffix}`,
      origin,
      createdAt: new Date("2026-02-10T10:10:00.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "analytics.record_sample",
        commandId: randomUUID(),
        queueId: queueCode,
        source: "internal_xrf",
        ptPpm: 602,
        pdPpm: 942,
        rhPpm: 109,
        matrixId: null,
      },
    });

    await postCommand({
      idempotencyKey: `api-sample-icp-${suffix}`,
      origin,
      createdAt: new Date("2026-02-10T10:10:45.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "analytics.record_sample",
        commandId: randomUUID(),
        queueId: queueCode,
        source: "icp_final",
        ptPpm: 615,
        pdPpm: 960,
        rhPpm: 112,
        matrixId: null,
      },
    });

    await postCommand({
      idempotencyKey: `api-pricing-${suffix}`,
      origin,
      createdAt: new Date("2026-02-10T10:11:00.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "pricing.resolve_estimate",
        commandId: randomUUID(),
        queueId: queueCode,
        marketSnapshotId: randomUUID(),
        termsProfileId: randomUUID(),
        sourceCandidates: ["vin", "library_match"],
        attemptedFieldOverride: false,
      },
    });

    await postCommand({
      idempotencyKey: `api-hedge-${suffix}`,
      origin,
      createdAt: new Date("2026-02-10T10:12:00.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "hedge.open_position",
        commandId: randomUUID(),
        layer: "internal",
        scopeType: "queue",
        scopeId: queueCode,
        hedgedPtOz: 0.21,
        hedgedPdOz: 0.32,
        hedgedRhOz: 0.05,
      },
    });

    const ledgerPosting = await postCommand({
      idempotencyKey: `api-ledger-${suffix}`,
      origin,
      createdAt: new Date("2026-02-10T10:13:00.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "finance.post_ledger_entry",
        commandId: randomUUID(),
        debitAccountId: "internal_funding_pool",
        creditAccountId: "buyer_alpha",
        amount: { amount: "4600.00", currency: "USD" },
        purposeCode: "funding_advance",
        sourceOperationalRef: queueCode,
        notes: "API integration baseline funding",
        evidence: { evidenceBundleId: randomUUID(), requiredTypesPresent: ["note"] },
      },
    });
    const originalLedgerEntryId = String(
      (ledgerPosting.effects as Record<string, unknown>).ledgerEntryId,
    );

    const openedCase = await postCommand({
      idempotencyKey: `api-open-case-${suffix}`,
      origin,
      createdAt: new Date("2026-02-10T10:14:00.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "reconciliation.open_case",
        commandId: randomUUID(),
        triggerType: "assay_variance",
        severity: "medium",
        relatedScopeType: "queue",
        relatedScopeId: queueCode,
      },
    });
    const caseId = String((openedCase.effects as Record<string, unknown>).reconciliationCaseId);

    await postCommand({
      idempotencyKey: `api-record-action-${suffix}`,
      origin,
      createdAt: new Date("2026-02-10T10:15:00.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "reconciliation.record_action",
        commandId: randomUUID(),
        caseId,
        actionType: "initial_investigation",
        actionPayload: { note: "Review opened in API integration harness." },
      },
    });

    await postCommand({
      idempotencyKey: `api-ledger-correction-${suffix}`,
      origin,
      createdAt: new Date("2026-02-10T10:16:00.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "finance.post_additive_correction",
        commandId: randomUUID(),
        targetLedgerEntryId: originalLedgerEntryId,
        reasonCode: "reconciliation",
        deltaUsd: "-180.00",
        notes: "API integration reconciliation correction.",
        reconciliationCaseId: caseId,
        evidence: { evidenceBundleId: randomUUID(), requiredTypesPresent: ["note"] },
      },
    });

    const exposureRowsBeforeSettlement = await getJson<
      {
        queueCode: string;
        estimatedValueUsd: string | null;
      }[]
    >("/workbench/pricing-exposure");
    const exposureBeforeSettlement = exposureRowsBeforeSettlement.find((row) => row.queueCode === queueCode);
    const estimatedQueueValueUsd = Number(exposureBeforeSettlement?.estimatedValueUsd ?? "75000");
    const finalizedValueUsd = (estimatedQueueValueUsd * 1.028).toFixed(2);

    await postCommand({
      idempotencyKey: `api-finalize-settlement-${suffix}`,
      origin,
      createdAt: new Date("2026-02-10T10:18:00.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "settlement.finalize_from_assay",
        commandId: randomUUID(),
        settlementId: queueCode,
        finalValueUsd: finalizedValueUsd,
      },
    });

    await postCommand({
      idempotencyKey: `api-close-case-${suffix}`,
      origin,
      createdAt: new Date("2026-02-10T10:19:00.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "reconciliation.close_case",
        commandId: randomUUID(),
        caseId,
        status: "resolved",
        closureRationale: "Correction posted and settlement finalized.",
      },
    });

    const reconciliationRows = await getJson<
      {
        reconciliationCaseId: string;
        status: string;
        actionCount: number;
      }[]
    >("/workbench/reconciliation");
    const caseRow = reconciliationRows.find((row) => row.reconciliationCaseId === caseId);
    assert.ok(caseRow, "Reconciliation case should be visible in workbench endpoint.");
    assert.equal(caseRow.status, "resolved", "Reconciliation case should be resolved.");
    assert.equal(caseRow.actionCount >= 2, true, "Resolved case should have action history.");

    const ledgerTrace = await getJson<{
      entries: { purposeCode: string; sourceOperationalRef: string }[];
    }>(`/projections/ledger-trace?sourceOperationalRef=${encodeURIComponent(queueCode)}`);
    assert.equal(
      ledgerTrace.entries.length >= 2,
      true,
      "Ledger trace should include original posting and additive correction.",
    );
    assert.equal(
      ledgerTrace.entries.some((entry) => entry.purposeCode === "adjustment"),
      true,
      "Ledger trace should include adjustment entry.",
    );

    const settlementRows = await getJson<
      {
        settlementId: string;
        scopeId: string;
        status: string;
      }[]
    >("/workbench/settlements");
    const settlementRow = settlementRows.find((row) => row.scopeId === queueCode);
    assert.ok(settlementRow, "Settlement should be present in workbench settlement list.");
    assert.equal(settlementRow.status, "finalized", "Settlement should be finalized.");

    const exposureRows = await getJson<{ queueCode: string; estimatedValueUsd: string | null }[]>(
      "/workbench/pricing-exposure",
    );
    const exposureRow = exposureRows.find((row) => row.queueCode === queueCode);
    assert.ok(exposureRow, "Queue should be present in pricing/exposure projection.");
    assert.notEqual(exposureRow.estimatedValueUsd, null, "Queue should have estimated value.");

    success = true;
    console.log(`API integration workflow PASS (${suffix})`);
  } finally {
    killProcessTree(apiProcess.pid);
    await sleep(300);

    if (!success && stderrBuffer.trim().length > 0) {
      console.log(`API stderr tail:\n${stderrBuffer.slice(-1200)}`);
    }
  }
}

runApiIntegrationWorkflow().catch((error) => {
  console.error("API integration workflow failed:", error);
  process.exit(1);
});
