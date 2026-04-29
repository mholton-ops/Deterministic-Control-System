import type { DependencyRef, DomainResult, OriginRef, TransactionId } from "./primitives";
import { failure, success } from "./primitives";

export interface TransactionEnvelope<TPayload> {
  readonly transactionId: TransactionId;
  readonly eventType: string;
  readonly origin: OriginRef;
  readonly payload: TPayload;
  readonly dependencies: readonly DependencyRef[];
  readonly createdAt: string;
  readonly idempotencyKey: string;
}

export function validateDependencies(
  dependencies: readonly DependencyRef[],
  availableStates: ReadonlyMap<string, string>,
): DomainResult<true> {
  for (const dependency of dependencies) {
    const key = `${dependency.entityType}:${dependency.entityId}`;
    const currentState = availableStates.get(key);
    if (!currentState) {
      return failure(
        "DEPENDENCY_MISSING",
        `Dependency ${key} was not found for transaction application.`,
      );
    }

    if (currentState !== dependency.requiredState) {
      return failure(
        "DEPENDENCY_STATE_MISMATCH",
        `Dependency ${key} expected state ${dependency.requiredState} but found ${currentState}.`,
      );
    }
  }

  return success(true);
}
