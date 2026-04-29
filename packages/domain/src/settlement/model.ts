import type { DomainResult } from "../shared/primitives";
import { failure, success } from "../shared/primitives";

export type SettlementStep =
  | "lot_selected"
  | "contents_reviewed"
  | "sample_data_recorded"
  | "adjustments_recorded"
  | "weight_basis_locked"
  | "hedges_applied"
  | "financial_context_applied"
  | "final_value_calculated"
  | "invoice_finalized";

const strictStepOrder: readonly SettlementStep[] = [
  "lot_selected",
  "contents_reviewed",
  "sample_data_recorded",
  "adjustments_recorded",
  "weight_basis_locked",
  "hedges_applied",
  "financial_context_applied",
  "final_value_calculated",
  "invoice_finalized",
];

export interface SettlementDraft {
  readonly settlementId: string;
  readonly completedSteps: readonly SettlementStep[];
  readonly estimatedValueUsd: string;
  readonly finalValueUsd: string | null;
  readonly finalized: boolean;
}

export function appendSettlementStep(
  draft: SettlementDraft,
  step: SettlementStep,
): DomainResult<SettlementDraft> {
  if (draft.finalized) {
    return failure("SETTLEMENT_ALREADY_FINALIZED", "Finalized settlements cannot accept more steps.");
  }

  const expectedStep = strictStepOrder[draft.completedSteps.length];
  if (step !== expectedStep) {
    return failure(
      "SETTLEMENT_OUT_OF_ORDER_STEP",
      `Expected step ${expectedStep} but received ${step}.`,
    );
  }

  return success({
    ...draft,
    completedSteps: [...draft.completedSteps, step],
    finalized: step === "invoice_finalized",
  });
}

export function calculateSettlementVariance(
  estimatedValueUsd: string,
  finalValueUsd: string,
): DomainResult<string> {
  const estimated = Number(estimatedValueUsd);
  const final = Number(finalValueUsd);

  if (Number.isNaN(estimated) || Number.isNaN(final)) {
    return failure("SETTLEMENT_INVALID_VALUE", "Settlement values must be numeric strings.");
  }

  return success((final - estimated).toFixed(2));
}
