import { eq } from "drizzle-orm";
import type { CommandDto } from "@dcs/contracts";
import type { DcsDb } from "@dcs/db";
import { devices, users } from "@dcs/db";

export class ControlledOriginError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ControlledOriginError";
  }
}

const rolePermissions: Readonly<Record<string, readonly string[]>> = {
  control_admin: ["*"],
  system: ["*"],
  operator: ["field.", "custody.", "grading.", "analytics.", "pricing.", "finance.", "hedge.", "settlement.", "reconciliation."],
  supervisor: ["field.", "custody.", "grading.", "analytics.", "pricing.", "finance.", "hedge.", "settlement.", "reconciliation."],
  field_operator: ["field.", "custody.assign_converter_to_box"],
  grader: ["grading."],
  analyst: ["analytics.", "pricing."],
  finance_operator: ["finance."],
  settlement_operator: ["settlement."],
  reconciliation_operator: ["reconciliation."],
  auditor: [],
};

function roleAllows(role: string, commandType: CommandDto["commandType"]): boolean {
  return (rolePermissions[role] ?? []).some(
    (permission) => permission === "*" || commandType.startsWith(permission),
  );
}

export async function assertControlledOrigin(
  db: DcsDb,
  origin: { userId: string; deviceId: string; sourceSystem: string },
  commandType: CommandDto["commandType"],
): Promise<{ readonly role: string }> {
  const userRows = await db
    .select({ userId: users.userId, role: users.role, active: users.active })
    .from(users)
    .where(eq(users.userId, origin.userId))
    .limit(1);
  const user = userRows[0];
  if (!user || !user.active) {
    throw new ControlledOriginError("origin_user_not_authorized", "The command origin user is unknown or inactive.");
  }

  const deviceRows = await db
    .select({ deviceId: devices.deviceId, assignedUserId: devices.assignedUserId, active: devices.active })
    .from(devices)
    .where(eq(devices.deviceId, origin.deviceId))
    .limit(1);
  const device = deviceRows[0];
  if (!device || !device.active) {
    throw new ControlledOriginError("origin_device_not_authorized", "The command origin device is unknown or inactive.");
  }
  if (device.assignedUserId !== user.userId) {
    throw new ControlledOriginError(
      "origin_device_assignment_mismatch",
      "The command origin device is not assigned to the origin user.",
    );
  }

  if (
    origin.sourceSystem === "field_client" &&
    !["field.capture_converter", "custody.assign_converter_to_box"].includes(commandType)
  ) {
    throw new ControlledOriginError("source_system_command_not_allowed", `Field clients cannot submit ${commandType}.`);
  }
  if (!roleAllows(user.role, commandType)) {
    throw new ControlledOriginError(
      "origin_role_not_authorized",
      `Role ${user.role} is not authorized for ${commandType}.`,
    );
  }
  return { role: user.role };
}
