import type { DomainResult, EvidenceRef, GeoPoint, OriginRef } from "../shared/primitives";
import { failure, success } from "../shared/primitives";

export type OriginationState = "captured" | "submitted_for_grading" | "rejected";

export interface FieldCaptureInput {
  readonly yardId: string;
  readonly boxId: string;
  readonly vinOrSerial: string | null;
  readonly capturedAt: string;
  readonly location: GeoPoint;
  readonly origin: OriginRef;
  readonly evidence: EvidenceRef;
}

export interface ConverterRecord {
  readonly converterId: string;
  readonly state: OriginationState;
  readonly yardId: string;
  readonly boxId: string;
  readonly vinOrSerial: string | null;
  readonly capturedAt: string;
  readonly location: GeoPoint;
  readonly origin: OriginRef;
  readonly evidence: EvidenceRef;
}

export function validateFieldCapture(input: FieldCaptureInput): DomainResult<true> {
  if (input.location.accuracyM > 200) {
    return failure(
      "ORIGINATION_GPS_LOW_CONFIDENCE",
      "GPS accuracy is too low for controlled field origination.",
    );
  }

  if (!input.evidence.requiredTypesPresent.includes("image")) {
    return failure(
      "ORIGINATION_IMAGE_REQUIRED",
      "Field capture must include image evidence.",
    );
  }

  if (!input.evidence.requiredTypesPresent.includes("gps")) {
    return failure(
      "ORIGINATION_GPS_REQUIRED",
      "Field capture must include GPS evidence.",
    );
  }

  return success(true);
}

export function submitForGrading(record: ConverterRecord): DomainResult<ConverterRecord> {
  if (record.state !== "captured") {
    return failure(
      "ORIGINATION_INVALID_SUBMISSION",
      "Only captured converter records can be submitted for grading.",
    );
  }

  return success({
    ...record,
    state: "submitted_for_grading",
  });
}
