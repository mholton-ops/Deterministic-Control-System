export type Brand<T, TBrand extends string> = T & { readonly __brand: TBrand };

export type EntityId = Brand<string, "EntityId">;
export type TransactionId = Brand<string, "TransactionId">;
export type UserId = Brand<string, "UserId">;
export type DeviceId = Brand<string, "DeviceId">;
export type EvidenceBundleId = Brand<string, "EvidenceBundleId">;
export type AccountId = Brand<string, "AccountId">;

export type CurrencyCode = "USD";
export type TruthStatus = "estimated" | "provisional" | "validated" | "finalized";
export type ConfidenceLevel = "high" | "medium" | "low" | "unknown";
export type DependencyState = "complete" | "incomplete";

export interface Money {
  readonly amount: string;
  readonly currency: CurrencyCode;
}

export interface GeoPoint {
  readonly lat: number;
  readonly lon: number;
  readonly accuracyM: number;
}

export interface OriginRef {
  readonly sourceSystem: "field_client" | "server" | "operator_console";
  readonly userId: UserId;
  readonly deviceId: DeviceId;
  readonly capturedAt: string;
}

export interface DependencyRef {
  readonly entityType: string;
  readonly entityId: string;
  readonly requiredState: string;
}

export interface TraceLinkRef {
  readonly entityType:
    | "converter"
    | "box"
    | "queue"
    | "shipment"
    | "sample"
    | "settlement"
    | "ledger_entry"
    | "reconciliation_case";
  readonly entityId: string;
}

export interface EvidenceRef {
  readonly evidenceBundleId: EvidenceBundleId;
  readonly requiredTypesPresent: readonly ("image" | "note" | "gps" | "video" | "document")[];
}

export interface CertaintyEnvelope {
  readonly truthStatus: TruthStatus;
  readonly confidence: ConfidenceLevel;
  readonly validationStatus: string;
  readonly dependencyState: DependencyState;
  readonly trace: TraceLinkRef;
}

export interface DomainViolation {
  readonly code: string;
  readonly message: string;
}

export interface Success<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Failure {
  readonly ok: false;
  readonly error: DomainViolation;
}

export type DomainResult<T> = Success<T> | Failure;

export function success<T>(value: T): Success<T> {
  return { ok: true, value };
}

export function failure(code: string, message: string): Failure {
  return { ok: false, error: { code, message } };
}
