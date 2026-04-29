import type { DomainResult } from "../shared/primitives";
import { failure, success } from "../shared/primitives";

export type IdentificationMethod = "vin" | "serial" | "library_match" | "category_fallback";
export type ConfidenceBand = "high" | "medium" | "low";

export interface LibraryCandidate {
  readonly candidateId: string;
  readonly method: IdentificationMethod;
  readonly confidence: ConfidenceBand;
  readonly baseEstimateUsd: string;
}

export interface GradingDecision {
  readonly decisionId: string;
  readonly converterId: string;
  readonly chosenCandidateId: string;
  readonly method: IdentificationMethod;
  readonly confidence: ConfidenceBand;
  readonly estimatedValueUsd: string;
  readonly overridden: boolean;
  readonly overrideReason: string | null;
}

const methodRank: Record<IdentificationMethod, number> = {
  vin: 4,
  serial: 3,
  library_match: 2,
  category_fallback: 1,
};

export function selectBestCandidate(candidates: readonly LibraryCandidate[]): DomainResult<LibraryCandidate> {
  if (candidates.length === 0) {
    return failure("GRADING_NO_CANDIDATES", "No grading candidates were provided.");
  }

  const sorted = [...candidates].sort((a, b) => {
    if (methodRank[a.method] !== methodRank[b.method]) {
      return methodRank[b.method] - methodRank[a.method];
    }

    if (a.confidence === b.confidence) {
      return 0;
    }

    if (a.confidence === "high") return -1;
    if (b.confidence === "high") return 1;
    if (a.confidence === "medium") return -1;
    return 1;
  });

  return success(sorted[0]);
}

export function createGradingDecision(input: {
  readonly decisionId: string;
  readonly converterId: string;
  readonly candidate: LibraryCandidate;
  readonly overrideReason?: string;
}): DomainResult<GradingDecision> {
  const overridden = Boolean(input.overrideReason);
  if (overridden && !input.overrideReason) {
    return failure("GRADING_OVERRIDE_REASON_REQUIRED", "Override operations require a reason.");
  }

  return success({
    decisionId: input.decisionId,
    converterId: input.converterId,
    chosenCandidateId: input.candidate.candidateId,
    method: input.candidate.method,
    confidence: input.candidate.confidence,
    estimatedValueUsd: input.candidate.baseEstimateUsd,
    overridden,
    overrideReason: input.overrideReason ?? null,
  });
}
