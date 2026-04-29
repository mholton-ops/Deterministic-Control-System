import type { DomainResult } from "../shared/primitives";
import { failure, success } from "../shared/primitives";

export type SampleSource = "internal_xrf" | "external_xrf" | "icp_final";

export interface ElementReadings {
  readonly ptPpm: number;
  readonly pdPpm: number;
  readonly rhPpm: number;
}

export interface CorrectionMatrix {
  readonly matrixId: string;
  readonly materialFingerprint: string;
  readonly ptMultiplier: number;
  readonly pdMultiplier: number;
  readonly rhMultiplier: number;
  readonly confidence: "qualified" | "candidate";
}

export interface CorrectedReadings {
  readonly ptPpm: number;
  readonly pdPpm: number;
  readonly rhPpm: number;
}

export function applyMatrixCorrection(
  raw: ElementReadings,
  matrix: CorrectionMatrix,
): DomainResult<CorrectedReadings> {
  if (matrix.confidence !== "qualified") {
    return failure(
      "ANALYTICS_MATRIX_NOT_QUALIFIED",
      "Only qualified correction matrices can be applied to pricing-critical estimates.",
    );
  }

  return success({
    ptPpm: raw.ptPpm * matrix.ptMultiplier,
    pdPpm: raw.pdPpm * matrix.pdMultiplier,
    rhPpm: raw.rhPpm * matrix.rhMultiplier,
  });
}

export function estimateContainedPgms(readings: CorrectedReadings, netWeightKg: number): DomainResult<ElementReadings> {
  if (netWeightKg <= 0) {
    return failure("ANALYTICS_INVALID_WEIGHT", "Net weight must be positive for contained metal estimation.");
  }

  return success({
    ptPpm: (readings.ptPpm * netWeightKg) / 1000,
    pdPpm: (readings.pdPpm * netWeightKg) / 1000,
    rhPpm: (readings.rhPpm * netWeightKg) / 1000,
  });
}

export function compareEstimateToFinal(
  estimate: ElementReadings,
  final: ElementReadings,
  tolerancePct: number,
): DomainResult<true> {
  const deltas: number[] = [];
  const fields: readonly (keyof ElementReadings)[] = ["ptPpm", "pdPpm", "rhPpm"];

  for (const field of fields) {
    const finalValue = final[field];
    if (finalValue === 0) {
      continue;
    }

    deltas.push(Math.abs((estimate[field] - finalValue) / finalValue) * 100);
  }

  const maxDelta = Math.max(...deltas, 0);
  if (maxDelta > tolerancePct) {
    return failure(
      "ANALYTICS_ESTIMATE_VARIANCE_HIGH",
      `Estimated vs final analytical variance ${maxDelta.toFixed(2)}% exceeds ${tolerancePct.toFixed(2)}%.`,
    );
  }

  return success(true);
}
