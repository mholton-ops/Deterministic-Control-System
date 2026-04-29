import type { DomainResult } from "../shared/primitives";
import { failure, success } from "../shared/primitives";

export type HedgeLayer = "internal" | "external";
export type HedgeStatus = "open" | "partially_applied" | "closed";

export interface HedgePosition {
  readonly hedgePositionId: string;
  readonly layer: HedgeLayer;
  readonly associatedScopeType: "queue" | "lot" | "material_group";
  readonly associatedScopeId: string;
  readonly hedgedPtOz: number;
  readonly hedgedPdOz: number;
  readonly hedgedRhOz: number;
  readonly status: HedgeStatus;
}

export interface ExposureSnapshot {
  readonly estimatedPtOz: number;
  readonly estimatedPdOz: number;
  readonly estimatedRhOz: number;
  readonly hedgedPtOz: number;
  readonly hedgedPdOz: number;
  readonly hedgedRhOz: number;
}

export interface NeedHedged {
  readonly ptOz: number;
  readonly pdOz: number;
  readonly rhOz: number;
}

export function calculateNeedHedged(snapshot: ExposureSnapshot): NeedHedged {
  return {
    ptOz: Math.max(snapshot.estimatedPtOz - snapshot.hedgedPtOz, 0),
    pdOz: Math.max(snapshot.estimatedPdOz - snapshot.hedgedPdOz, 0),
    rhOz: Math.max(snapshot.estimatedRhOz - snapshot.hedgedRhOz, 0),
  };
}

export function applyHedge(
  position: HedgePosition,
  applicationRatio: number,
): DomainResult<HedgePosition> {
  if (applicationRatio <= 0 || applicationRatio > 1) {
    return failure("HEDGE_INVALID_APPLICATION_RATIO", "Hedge application ratio must be in (0, 1].");
  }

  const nextStatus: HedgeStatus = applicationRatio === 1 ? "closed" : "partially_applied";

  return success({
    ...position,
    status: nextStatus,
  });
}
