import type { DomainResult } from "../shared/primitives";
import { failure, success } from "../shared/primitives";
import { assertAllowedTransition } from "../shared/state-machine";

export type ReconciliationStatus = "open" | "investigating" | "resolved" | "accepted_variance";
export type ReconciliationSeverity = "low" | "medium" | "high" | "critical";

const transitions = new Map<ReconciliationStatus, readonly ReconciliationStatus[]>([
  ["open", ["investigating", "accepted_variance"]],
  ["investigating", ["resolved", "accepted_variance"]],
  ["resolved", []],
  ["accepted_variance", []],
]);

export interface ReconciliationCase {
  readonly caseId: string;
  readonly triggerType:
    | "weight_delta"
    | "assay_variance"
    | "custody_mismatch"
    | "ledger_orphan"
    | "sequence_violation";
  readonly severity: ReconciliationSeverity;
  readonly status: ReconciliationStatus;
  readonly relatedScopeType: "queue" | "lot" | "shipment" | "ledger";
  readonly relatedScopeId: string;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly closureRationale: string | null;
}

export function transitionReconciliationCase(
  current: ReconciliationCase,
  nextStatus: ReconciliationStatus,
  closureRationale?: string,
): DomainResult<ReconciliationCase> {
  const transitionResult = assertAllowedTransition(
    current.status,
    nextStatus,
    transitions,
    "ReconciliationCase",
  );
  if (!transitionResult.ok) {
    return transitionResult;
  }

  if ((nextStatus === "resolved" || nextStatus === "accepted_variance") && !closureRationale) {
    return failure(
      "RECONCILIATION_CLOSURE_RATIONALE_REQUIRED",
      "Closing a reconciliation case requires a closure rationale.",
    );
  }

  return success({
    ...current,
    status: nextStatus,
    closedAt: nextStatus === "resolved" || nextStatus === "accepted_variance" ? new Date().toISOString() : null,
    closureRationale: closureRationale ?? null,
  });
}
