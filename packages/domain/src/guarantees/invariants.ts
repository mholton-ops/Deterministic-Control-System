import type { DomainResult, EvidenceRef } from "../shared/primitives";
import { failure, success } from "../shared/primitives";

export interface DriftCheckInput {
  readonly projectionChecksumsByName: ReadonlyMap<string, string>;
}

export function enforceNoDrift(input: DriftCheckInput): DomainResult<true> {
  const checksums = Array.from(input.projectionChecksumsByName.values());
  const baseline = checksums[0];
  const drifted = checksums.some((checksum) => checksum !== baseline);

  if (drifted) {
    return failure("GUARANTEE_NO_DRIFT_VIOLATION", "Projection checksums diverged under identical transaction history.");
  }

  return success(true);
}

export function enforceEvidenceBackedState(evidence: EvidenceRef): DomainResult<true> {
  if (!evidence.requiredTypesPresent.includes("image")) {
    return failure("GUARANTEE_EVIDENCE_IMAGE_REQUIRED", "Critical state requires image evidence.");
  }

  if (!evidence.requiredTypesPresent.includes("gps")) {
    return failure("GUARANTEE_EVIDENCE_GPS_REQUIRED", "Critical state requires GPS evidence.");
  }

  return success(true);
}

export interface FinancialPhysicalLink {
  readonly ledgerEntryId: string;
  readonly operationalRef: string | null;
}

export function enforceFinancialPhysicalAlignment(
  links: readonly FinancialPhysicalLink[],
): DomainResult<true> {
  const orphan = links.find((link) => !link.operationalRef);
  if (orphan) {
    return failure(
      "GUARANTEE_FINANCIAL_PHYSICAL_ALIGNMENT_VIOLATION",
      `Ledger entry ${orphan.ledgerEntryId} is missing operational linkage.`,
    );
  }

  return success(true);
}

export interface ReconstructionInput {
  readonly appliedTransactionIds: readonly string[];
  readonly sourceTransactionIds: readonly string[];
}

export function enforceReconstructability(input: ReconstructionInput): DomainResult<true> {
  const sourceSet = new Set(input.sourceTransactionIds);
  for (const appliedId of input.appliedTransactionIds) {
    if (!sourceSet.has(appliedId)) {
      return failure(
        "GUARANTEE_RECONSTRUCTABILITY_VIOLATION",
        `Applied transaction ${appliedId} is missing from source transaction set.`,
      );
    }
  }

  return success(true);
}
