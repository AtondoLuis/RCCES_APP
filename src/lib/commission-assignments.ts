import type { AssignmentMap } from "@/lib/auto-assign";

export function isAssignedToAnotherService(
  assignments: AssignmentMap,
  serviceId: string,
  personId: string,
): boolean {
  return Object.entries(assignments).some(([assignedServiceId, ids]) =>
    assignedServiceId !== serviceId && ids.includes(personId),
  );
}

export function canAssignToService(
  assignments: AssignmentMap,
  serviceId: string,
  personId: string,
  allowMultipleServices: boolean,
): boolean {
  return allowMultipleServices || !isAssignedToAnotherService(assignments, serviceId, personId);
}
