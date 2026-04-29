import type { DomainResult, EvidenceRef } from "../shared/primitives";
import { failure, success } from "../shared/primitives";

export type AccountType = "buyer" | "warehouse" | "bank" | "customer" | "internal";

export interface Account {
  readonly accountId: string;
  readonly type: AccountType;
  readonly active: boolean;
}

export interface LedgerPostingInput {
  readonly ledgerEntryId: string;
  readonly debitAccountId: string;
  readonly creditAccountId: string;
  readonly amountUsd: string;
  readonly purposeCode:
    | "funding_advance"
    | "field_purchase"
    | "deposit"
    | "settlement_payout"
    | "adjustment"
    | "wire";
  readonly sourceOperationalRef: string;
  readonly notes: string;
  readonly evidence: EvidenceRef;
}

export function validateLedgerPosting(
  posting: LedgerPostingInput,
  accounts: ReadonlyMap<string, Account>,
): DomainResult<true> {
  const debit = accounts.get(posting.debitAccountId);
  const credit = accounts.get(posting.creditAccountId);

  if (!debit || !credit) {
    return failure("FINANCE_ACCOUNT_NOT_FOUND", "Ledger posting references unknown account(s).");
  }

  if (!debit.active || !credit.active) {
    return failure("FINANCE_ACCOUNT_INACTIVE", "Ledger posting references inactive account(s).");
  }

  if (posting.debitAccountId === posting.creditAccountId) {
    return failure("FINANCE_SELF_POSTING_BLOCKED", "Debit and credit accounts must be distinct.");
  }

  if (!posting.sourceOperationalRef.trim()) {
    return failure(
      "FINANCE_SOURCE_REF_REQUIRED",
      "Financial movement requires an operational source reference.",
    );
  }

  if (!posting.notes.trim()) {
    return failure("FINANCE_NOTES_REQUIRED", "Financial posting requires explanatory notes.");
  }

  if (!posting.evidence.requiredTypesPresent.includes("note")) {
    return failure(
      "FINANCE_EVIDENCE_NOTE_REQUIRED",
      "Financial posting requires evidence bundle with note provenance.",
    );
  }

  return success(true);
}

export interface AdditiveCorrection {
  readonly correctionEntryId: string;
  readonly targetLedgerEntryId: string;
  readonly reasonCode: "estimate_adjustment" | "reconciliation" | "operator_error";
  readonly deltaUsd: string;
}

export function validateAdditiveCorrection(correction: AdditiveCorrection): DomainResult<true> {
  if (!correction.targetLedgerEntryId.trim()) {
    return failure("FINANCE_CORRECTION_TARGET_REQUIRED", "Correction entries must reference a target entry.");
  }

  if (Number(correction.deltaUsd) === 0) {
    return failure("FINANCE_CORRECTION_ZERO_DELTA", "Correction entries must carry a non-zero delta.");
  }

  return success(true);
}
