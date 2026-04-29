import type { DomainResult } from "./primitives";
import { failure, success } from "./primitives";

export function assertAllowedTransition<TState extends string>(
  from: TState,
  to: TState,
  allowed: ReadonlyMap<TState, readonly TState[]>,
  entityLabel: string,
): DomainResult<TState> {
  const allowedTargets = allowed.get(from) ?? [];
  if (!allowedTargets.includes(to)) {
    return failure(
      "INVALID_STATE_TRANSITION",
      `${entityLabel} cannot transition from ${from} to ${to}.`,
    );
  }

  return success(to);
}

export function requireCondition(
  condition: boolean,
  code: string,
  message: string,
): DomainResult<true> {
  if (!condition) {
    return failure(code, message);
  }

  return success(true);
}
