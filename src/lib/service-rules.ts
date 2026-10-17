export type RuleService = { id: string; name?: string; stable_key?: string | null; slug?: string | null; allow_multiple_people?: boolean };
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
  return !!fixedServiceText(service) || ["colecta", "ofrenda", "ofrenda-pan-vino", "ofrenda-pan-y-vino"].includes(serviceKey(service));
}
export function getRequiredAssignmentCount(service: RuleService, existingCount = 0): number {
  if (fixedServiceText(service)) return 0;
  if (serviceKey(service) === "colecta") return 4;
  if (["ofrenda", "ofrenda-pan-vino", "ofrenda-pan-y-vino"].includes(serviceKey(service))) return 2;
  return service.allow_multiple_people ? Math.max(1, existingCount) : 1;
}
export function assignmentRows(assignments: Record<string, string[]>, services: RuleService[]) {
  return services.filter((s) => !fixedServiceText(s)).flatMap((s) =>
    (assignments[s.id] ?? []).slice(0, getRequiredAssignmentCount(s, assignments[s.id]?.length)).flatMap((person_id, display_order) =>
      person_id ? [{ service_id: s.id, person_id, display_order }] : []));
}
