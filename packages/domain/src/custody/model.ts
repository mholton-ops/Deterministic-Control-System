import type { DomainResult } from "../shared/primitives";
import { failure, success } from "../shared/primitives";
import { assertAllowedTransition } from "../shared/state-machine";

export type ConverterState =
  | "captured"
  | "boxed"
  | "queued"
  | "in_transit"
  | "received"
  | "processing"
  | "sampled"
  | "settled";

export type BoxState = "empty" | "active" | "closed" | "shipped" | "received" | "retired";
export type QueueState = "open" | "processing" | "sampled" | "assay_pending" | "valued" | "settled";

const boxTransitions = new Map<BoxState, readonly BoxState[]>([
  ["empty", ["active"]],
  ["active", ["closed"]],
  ["closed", ["shipped"]],
  ["shipped", ["received"]],
  ["received", ["retired"]],
  ["retired", []],
]);

const queueTransitions = new Map<QueueState, readonly QueueState[]>([
  ["open", ["processing"]],
  ["processing", ["sampled"]],
  ["sampled", ["assay_pending"]],
  ["assay_pending", ["valued"]],
  ["valued", ["settled"]],
  ["settled", []],
]);

export interface Box {
  readonly boxId: string;
  readonly state: BoxState;
  readonly converterCount: number;
}

export interface Queue {
  readonly queueId: string;
  readonly state: QueueState;
  readonly lockedForProcessing: boolean;
}

export interface MassBalance {
  readonly inputWeightKg: number;
  readonly outputWeightKg: number;
  readonly explainedLossKg: number;
}

export function transitionBoxState(box: Box, nextState: BoxState): DomainResult<Box> {
  const transitionResult = assertAllowedTransition(box.state, nextState, boxTransitions, "Box");
  if (!transitionResult.ok) {
    return transitionResult;
  }

  return success({ ...box, state: nextState });
}

export function transitionQueueState(queue: Queue, nextState: QueueState): DomainResult<Queue> {
  const transitionResult = assertAllowedTransition(queue.state, nextState, queueTransitions, "Queue");
  if (!transitionResult.ok) {
    return transitionResult;
  }

  return success({ ...queue, state: nextState });
}

export function assignConverterToBox(
  converterState: ConverterState,
  box: Box,
): DomainResult<"boxed"> {
  if (converterState !== "captured") {
    return failure("CUSTODY_INVALID_CONVERTER_STATE", "Only captured converters can be boxed.");
  }

  if (box.state !== "active") {
    return failure("CUSTODY_BOX_NOT_ACTIVE", "Converters can only be assigned to active boxes.");
  }

  return success("boxed");
}

export function lockQueueForProcessing(queue: Queue): DomainResult<Queue> {
  if (queue.state !== "open") {
    return failure("CUSTODY_QUEUE_NOT_OPEN", "Only open queues can be locked for processing.");
  }

  return success({
    ...queue,
    state: "processing",
    lockedForProcessing: true,
  });
}

export function validateMassBalance(balance: MassBalance, toleranceKg = 0.25): DomainResult<true> {
  const observedDelta = Math.abs(balance.inputWeightKg - (balance.outputWeightKg + balance.explainedLossKg));
  if (observedDelta > toleranceKg) {
    return failure(
      "CUSTODY_MASS_BALANCE_VIOLATION",
      `Mass balance drift ${observedDelta.toFixed(3)}kg exceeds tolerance ${toleranceKg.toFixed(3)}kg.`,
    );
  }

  return success(true);
}
