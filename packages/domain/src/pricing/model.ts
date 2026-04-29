import type { DomainResult } from "../shared/primitives";
import { failure, success } from "../shared/primitives";

export type PricingSource = "vin" | "serial" | "library_match" | "category_fallback";

export interface MarketSnapshot {
  readonly ptUsdPerOz: number;
  readonly pdUsdPerOz: number;
  readonly rhUsdPerOz: number;
  readonly capturedAt: string;
}

export interface CustomerTerms {
  readonly termsProfileId: string;
  readonly payoutFactor: number;
  readonly processingChargeUsd: number;
  readonly treatmentChargeUsd: number;
}

export interface EstimatedPgms {
  readonly ptOz: number;
  readonly pdOz: number;
  readonly rhOz: number;
}

export interface PricingResolution {
  readonly estimateUsd: string;
  readonly source: PricingSource;
  readonly termsProfileId: string;
}

const sourceRank: Record<PricingSource, number> = {
  vin: 4,
  serial: 3,
  library_match: 2,
  category_fallback: 1,
};

export function resolvePricingSource(candidates: readonly PricingSource[]): DomainResult<PricingSource> {
  if (candidates.length === 0) {
    return failure("PRICING_NO_SOURCE", "At least one pricing source must be provided.");
  }

  let best: PricingSource = candidates[0];
  for (const candidate of candidates) {
    if (sourceRank[candidate] > sourceRank[best]) {
      best = candidate;
    }
  }

  return success(best);
}

export function calculateEstimatedValue(input: {
  readonly market: MarketSnapshot;
  readonly estimatedPgms: EstimatedPgms;
  readonly terms: CustomerTerms;
  readonly source: PricingSource;
  readonly attemptedFieldOverride: boolean;
}): DomainResult<PricingResolution> {
  if (input.attemptedFieldOverride) {
    return failure(
      "PRICING_FIELD_OVERRIDE_BLOCKED",
      "Field-origin actors cannot override centrally controlled pricing decisions.",
    );
  }

  const metalValue =
    input.estimatedPgms.ptOz * input.market.ptUsdPerOz +
    input.estimatedPgms.pdOz * input.market.pdUsdPerOz +
    input.estimatedPgms.rhOz * input.market.rhUsdPerOz;

  const adjusted = metalValue * input.terms.payoutFactor - input.terms.processingChargeUsd - input.terms.treatmentChargeUsd;

  return success({
    estimateUsd: adjusted.toFixed(2),
    source: input.source,
    termsProfileId: input.terms.termsProfileId,
  });
}
