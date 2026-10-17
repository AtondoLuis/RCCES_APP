import { getAvailableAuthorizedPeople, type AutoAssignInput, type AssignmentMap } from "./auto-assign";
import { countsForRotation } from "./commission-status";
import { getRequiredAssignmentCount, isAuxiliaryAssignment } from "./service-rules";

export type CleaningHistory = { mass_id: string | null; person_id: string; service_id: string | null };
export type CleaningAssignInput = AutoAssignInput & { cleaningHistory?: CleaningHistory[] };

// Only cleaning_assignments influences this rotation. Liturgical reuse settings do not apply.
export function generateCleaningAssignments(input: CleaningAssignInput) {
  const target = Date.parse(`${input.date}T${input.time}Z`);
  if (!Number.isFinite(target) || !input.parishId || !input.massTimeId) throw new Error("Selecciona una fecha y un horario v\u00e1lidos.");
  const pastMasses = input.masses.filter((mass) => mass.parish_id === input.parishId
    && mass.id !== input.massId && countsForRotation(mass.status)
    && Date.parse(`${mass.mass_date}T${mass.time}Z`) < target)
    .sort((a, b) => `${b.mass_date}T${b.time}`.localeCompare(`${a.mass_date}T${a.time}`) || a.id.localeCompare(b.id));
  const massById = new Map(pastMasses.map((mass) => [mass.id, mass]));
  const previousId = pastMasses[0]?.id;
  const historyByPerson = new Map<string, { age: number; massId: string }[]>();
  const seen = new Set<string>();
  for (const row of input.cleaningHistory ?? []) {
    const mass = row.mass_id ? massById.get(row.mass_id) : undefined;
    if (!mass || seen.has(`${row.mass_id}|${row.person_id}`)) continue;
    seen.add(`${row.mass_id}|${row.person_id}`);
    const age = (Date.parse(`${input.date}T00:00:00Z`) - Date.parse(`${mass.mass_date}T00:00:00Z`)) / 86_400_000;
    const rows = historyByPerson.get(row.person_id) ?? [];
    rows.push({ age, massId: mass.id }); historyByPerson.set(row.person_id, rows);
  }
  const services = input.services.filter((service) => service.active && isAuxiliaryAssignment(service)
    && (!service.parish_id || service.parish_id === input.parishId));
  const assignments: AssignmentMap = {};
  const slots: { serviceId: string; index: number; candidates: string[]; order: number }[] = [];
  for (const service of services) {
    const count = getRequiredAssignmentCount(service, input.existingAssignments[service.id]?.length ?? 0);
    assignments[service.id] = Array<string>(count).fill("");
    const candidates = getAvailableAuthorizedPeople(input, service).map((person) => {
      const rows = historyByPerson.get(person.id) ?? [];
      return { id: person.id, wait: rows.length ? Math.min(...rows.map((row) => row.age)) : Infinity,
        recent: rows.filter((row) => row.age <= 30).length,
        previous: Number(rows.some((row) => row.massId === previousId)),
        recent60: rows.filter((row) => row.age <= 60).length };
    }).sort((a, b) => (a.wait === b.wait ? 0 : a.wait > b.wait ? -1 : 1)
      || a.recent - b.recent || a.previous - b.previous || a.recent60 - b.recent60
      || tie(`${input.date}|${input.massTimeId}|${service.id}|${a.id}`) - tie(`${input.date}|${input.massTimeId}|${service.id}|${b.id}`)
      || a.id.localeCompare(b.id)).map((person) => person.id);
    for (let index = 0; index < count; index++) slots.push({ serviceId: service.id, index, candidates, order: service.display_order });
  }
  // Match within cleaning only; a liturgical assignment never blocks a candidate here.
  slots.sort((a, b) => a.candidates.length - b.candidates.length || a.order - b.order || a.serviceId.localeCompare(b.serviceId) || a.index - b.index);
  const owners = new Map<string, number>();
  const chosen = Array<string>(slots.length).fill("");
  function match(index: number, visited: Set<string>): boolean {
    const free = slots[index].candidates.find((id) => !visited.has(id) && !owners.has(id));
    if (free) { owners.set(free, index); chosen[index] = free; return true; }
    for (const id of slots[index].candidates) {
      if (visited.has(id)) continue;
      visited.add(id);
      const owner = owners.get(id);
      if (owner === undefined || match(owner, visited)) { owners.set(id, index); chosen[index] = id; return true; }
    }
    return false;
  }
  for (let index = 0; index < slots.length; index++) match(index, new Set());
  for (const [index, slot] of slots.entries()) assignments[slot.serviceId][slot.index] = chosen[index];
  return { assignments, missingCount: Object.values(assignments).flat().filter((id) => !id).length };
}
function tie(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  return hash >>> 0;
}
