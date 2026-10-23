import { isMassService, type RuleService } from "./service-rules";
import type { AssignmentMap } from "@/lib/auto-assign";

export function isAssignedToAnotherService(
  assignments: AssignmentMap,
  serviceId: string,
  personId: string,
  services: RuleService[] = [],
): boolean {
  if (services.some((s) => s.id === serviceId && !isMassService(s))) return false;
  return Object.entries(assignments).some(([assignedServiceId, ids]) =>
    assignedServiceId !== serviceId && !services.some((s) => s.id === assignedServiceId && !isMassService(s)) && ids.includes(personId),
  );
}

export function canAssignToService(
  assignments: AssignmentMap,
  serviceId: string,
  personId: string,
  allowMultipleServices: boolean,
  services: RuleService[] = [],
): boolean {
  return allowMultipleServices || !isAssignedToAnotherService(assignments, serviceId, personId, services);
}

export function assignedMassServiceNames(
  assignments: AssignmentMap,
  serviceId: string,
  personId: string,
  services: RuleService[],
): string[] {
  const names = new Set<string>();
  for (const service of services) {
    if (service.id === serviceId || !isMassService(service) || !(assignments[service.id] ?? []).includes(personId)) continue;
    names.add(service.name || service.id);
  }
  return [...names];
}
