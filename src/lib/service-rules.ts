export type RuleService = { id: string; name?: string; stable_key?: string | null; slug?: string | null; allow_multiple_people?: boolean; required_servers?: number };
const normalize = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export function serviceKey(service: RuleService): string {
  return normalize(service.stable_key || service.slug || service.name || service.id);
}
export function fixedServiceText(service: RuleService): string | null {
  return serviceKey(service) === "bienvenida" ? "Todos" : null;
}
export function isAuxiliaryAssignment(service: RuleService): boolean {
  return serviceKey(service).startsWith("limpieza");
}
export function isMassService(service: RuleService): boolean {
  return !isAuxiliaryAssignment(service) && !fixedServiceText(service);
}
export function hasFixedAssignmentCount(service: RuleService): boolean {
  return !isAuxiliaryAssignment(service);
}
export function getRequiredAssignmentCount(service: RuleService, existingCount = 0): number {
  if (fixedServiceText(service)) return 0;
  // Cleaning retains its independent, existing editable slot count.
  if (isAuxiliaryAssignment(service)) return service.allow_multiple_people ? Math.max(1, existingCount) : 1;
  const count = service.required_servers ?? 1;
  if (!isValidRequiredServers(count)) throw new Error("Servidores requeridos debe ser un entero mayor o igual a 1.");
  return count;
}
export function isValidRequiredServers(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 2147483647;
}
export function assignmentRows(assignments: Record<string, string[]>, services: RuleService[]) {
  return services.filter((s) => !fixedServiceText(s)).flatMap((s) =>
    (assignments[s.id] ?? []).slice(0, getRequiredAssignmentCount(s, assignments[s.id]?.length)).flatMap((person_id, display_order) =>
      person_id ? [{ service_id: s.id, person_id, display_order }] : []));
}
