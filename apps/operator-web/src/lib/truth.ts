import type {
  AnalyticsRow,
  CustodyProjection,
  IntakeRow,
  QueueExposureRow,
  ReconciliationRow,
  SettlementListRow,
} from "./api";

export type TruthStatus = "estimated" | "provisional" | "validated" | "finalized";
export type ConfidenceLevel = "high" | "medium" | "low" | "unknown";

export interface LifecycleAssessment {
  readonly truthStatus: TruthStatus;
  readonly confidence: ConfidenceLevel;
  readonly validationStatus: string;
}

export function assessIntake(row: IntakeRow, hasMissingEvidence: boolean): LifecycleAssessment {
  const truthStatus: TruthStatus = row.state === "settled" ? "finalized" : "provisional";
  if (hasMissingEvidence) {
    return {
      truthStatus,
      confidence: "low",
      validationStatus: "awaiting_evidence",
    };
  }

  return {
    truthStatus: row.state === "settled" ? "finalized" : "validated",
    confidence: "high",
    validationStatus: "origin_verified",
  };
}

export function assessQueue(row: CustodyProjection["queues"][number]): LifecycleAssessment {
  const possibleVariance = Number(row.possibleVarianceUsd ?? "0");
  const hasOpenDivergence = row.openReconciliationCount > 0;

  if (row.state === "settled") {
    return {
      truthStatus: "finalized",
      confidence: "high",
      validationStatus: "settled",
    };
  }
  if (row.state === "valued") {
    return {
      truthStatus: "validated",
      confidence: row.estimatedValueUsd ? "medium" : "low",
      validationStatus: "valuation_locked",
    };
  }
  if (row.state === "sampled" || row.state === "assay_pending") {
    return {
      truthStatus: "provisional",
      confidence: hasOpenDivergence || possibleVariance > 75_000 ? "low" : "medium",
      validationStatus: hasOpenDivergence ? "awaiting_assay_with_divergence" : "awaiting_assay",
    };
  }
  return {
    truthStatus: row.estimatedValueUsd ? "estimated" : "provisional",
    confidence: hasOpenDivergence ? "low" : row.lockedForProcessing ? "medium" : "low",
    validationStatus: hasOpenDivergence
      ? "processing_with_open_divergence"
      : row.lockedForProcessing
        ? "processing_locked"
        : "processing_unlocked",
  };
}

export function assessSample(row: AnalyticsRow): LifecycleAssessment {
  if (row.source === "icp_final") {
    return {
      truthStatus: "finalized",
      confidence: "high",
      validationStatus: "external_assay",
    };
  }
  if (row.matrixQualificationStatus === "qualified") {
    return {
      truthStatus: "validated",
      confidence: "medium",
      validationStatus: "matrix_corrected",
    };
  }

  return {
    truthStatus: "estimated",
    confidence: row.source === "internal_xrf" ? "medium" : "low",
    validationStatus: "screening_only",
  };
}

export function assessExposure(row: QueueExposureRow): LifecycleAssessment {
  if (row.settlementStatus === "finalized") {
    return {
      truthStatus: "finalized",
      confidence: "high",
      validationStatus: "assay_closed",
    };
  }
  if (row.settlementStatus === "validated") {
    return {
      truthStatus: "validated",
      confidence: "medium",
      validationStatus: "awaiting_invoice",
    };
  }
  if (row.estimatedValueUsd && row.confidenceBand) {
    const possibleVariance = Number(row.possibleVarianceUsd ?? "0");
    return {
      truthStatus: "estimated",
      confidence:
        row.confidenceBand === "high" && possibleVariance < 20_000
          ? "high"
          : row.confidenceBand === "medium" && possibleVariance < 45_000
            ? "medium"
            : "low",
      validationStatus: row.openDivergenceCount > 0 ? "awaiting_assay_with_divergence" : "awaiting_assay",
    };
  }

  return {
    truthStatus: "provisional",
    confidence: "unknown",
    validationStatus: "insufficient_inputs",
  };
}

export function assessSettlement(row: SettlementListRow): LifecycleAssessment {
  if (row.status === "finalized") {
    return {
      truthStatus: "finalized",
      confidence: "high",
      validationStatus: "invoice_immutable",
    };
  }
  if (row.status === "validated") {
    return {
      truthStatus: "validated",
      confidence: "medium",
      validationStatus: "awaiting_final_invoice",
    };
  }
  return {
    truthStatus: "provisional",
    confidence: "low",
    validationStatus: "awaiting_assay",
  };
}

export function assessReconciliation(row: ReconciliationRow): LifecycleAssessment {
  if (row.status === "resolved" || row.status === "accepted_variance") {
    return {
      truthStatus: "validated",
      confidence: "high",
      validationStatus: "reconciled",
    };
  }
  if (row.status === "investigating") {
    return {
      truthStatus: "provisional",
      confidence: "medium",
      validationStatus: "investigation_active",
    };
  }
  return {
    truthStatus: "provisional",
    confidence: "low",
    validationStatus: "unresolved_divergence",
  };
}
