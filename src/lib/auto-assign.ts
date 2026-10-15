export type AssignmentMap = Record<string, string[]>;

export type AssignmentPerson = {
  id: string;
  parish_id: string;
  active: boolean;
  services: string[];
};

export type AssignmentService = {
  id: string;
  name: string;
  active: boolean;
  display_order: number;
  allow_multiple_people: boolean;
  parish_id?: string;
};

export type AssignmentMass = {
  id: string;
  parish_id: string;
  mass_date: string;
  mass_time_id: string | null;
  time: string;
  status: string;
};

export type AssignmentHistory = { mass_id: string; person_id: string; service_id: string };
export type AssignmentAvailability = {
  person_id: string;
  mass_date: string;
  mass_time_id: string | null;
  mass_id?: string | null;
  status: string;
};

export type AutoAssignInput = {
  parishId: string;
  date: string;
  massTimeId: string;
  time: string;
  massId?: string;
  people: AssignmentPerson[];
  services: AssignmentService[];
  masses: AssignmentMass[];
  history: AssignmentHistory[];
  availability: AssignmentAvailability[];
  existingAssignments: AssignmentMap;
  allowMultiplePeople?: boolean;
};

const dayMs = 86_400_000;
const timestamp = (date: string, time: string) => Date.parse(`${date}T${time.length === 5 ? `${time}:00` : time}Z`);

export function getEligiblePeople(input: AutoAssignInput, service: AssignmentService): AssignmentPerson[] {
  if (!service.active || (service.parish_id && service.parish_id !== input.parishId)) return [];
  return input.people.filter((person) => person.active && person.parish_id === input.parishId
    && person.services.includes(service.id)
    && !input.availability.some((record) => record.person_id === person.id
      && record.status === "unavailable" && record.mass_date === input.date
      && (record.mass_id ? record.mass_id === input.massId
        : !record.mass_time_id || record.mass_time_id === input.massTimeId)));
}

export type RotationStats = {
  daysSinceLast: number;
  daysSinceService: number;
  recent30: number;
  recent60: number;
  sameService30: number;
  lastWeek: number;
  servedPreviousMass: boolean;
};

export function scoreCandidate(stats: RotationStats): number {
  return 100 + Math.min(stats.daysSinceLast, 60) + Math.min(stats.daysSinceService, 60)
    - stats.recent30 * 15 - stats.recent60 * 5 - stats.sameService30 * 25
    - stats.lastWeek * 10 - (stats.servedPreviousMass ? 30 : 0);
}

function tieBreaker(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619);
  return hash >>> 0;
}

export function generateAssignments(input: AutoAssignInput): {
  assignments: AssignmentMap;
  unfilledServices: string[];
  reusedPersonIds: string[];
} {
  const target = timestamp(input.date, input.time);
  if (!Number.isFinite(target) || !input.parishId || !input.massTimeId) throw new Error("Selecciona una fecha y un horario válidos.");
  const pastMasses = input.masses.filter((mass) => mass.parish_id === input.parishId
    && mass.id !== input.massId && mass.status !== "cancelled"
    && timestamp(mass.mass_date, mass.time) < target)
    .sort((a, b) => timestamp(b.mass_date, b.time) - timestamp(a.mass_date, a.time) || a.id.localeCompare(b.id));
  const massById = new Map(pastMasses.map((mass) => [mass.id, mass]));
  const previousId = pastMasses[0]?.id;
  const historyByPerson = new Map<string, Array<AssignmentHistory & { age: number }>>();
  for (const row of input.history) {
    const mass = massById.get(row.mass_id);
    if (!mass) continue;
    const age = (Date.parse(`${input.date}T00:00:00Z`) - Date.parse(`${mass.mass_date}T00:00:00Z`)) / dayMs;
    const rows = historyByPerson.get(row.person_id) ?? [];
    rows.push({ ...row, age });
    historyByPerson.set(row.person_id, rows);
  }
  const services = input.services.filter((service) => service.active
    && (!service.parish_id || service.parish_id === input.parishId));
  const assignments: AssignmentMap = {};
  const slots: Array<{ serviceId: string; index: number; candidates: string[] }> = [];
  for (const service of services) {
    const count = service.allow_multiple_people || input.allowMultiplePeople
      ? Math.max(1, input.existingAssignments[service.id]?.length ?? 0) : 1;
    assignments[service.id] = Array<string>(count).fill("");
    const ranked = getEligiblePeople(input, service).map((person) => {
      const rows = historyByPerson.get(person.id) ?? [];
      const sameService = rows.filter((row) => row.service_id === service.id);
      return { id: person.id, score: scoreCandidate({
        daysSinceLast: rows.length ? Math.min(...rows.map((row) => row.age)) : 60,
        daysSinceService: sameService.length ? Math.min(...sameService.map((row) => row.age)) : 60,
        recent30: rows.filter((row) => row.age <= 30).length,
        recent60: rows.filter((row) => row.age <= 60).length,
        sameService30: sameService.filter((row) => row.age <= 30).length,
        lastWeek: rows.filter((row) => row.age <= 7).length,
        servedPreviousMass: rows.some((row) => row.mass_id === previousId),
      }), tie: tieBreaker(`${input.date}|${input.massTimeId}|${service.id}|${person.id}`) };
    }).sort((a, b) => b.score - a.score || a.tie - b.tie || a.id.localeCompare(b.id));
    for (let index = 0; index < count; index++) slots.push({ serviceId: service.id, index, candidates: ranked.map((person) => person.id) });
  }
  // Maximum matching avoids reusing a flexible volunteer while a unique allocation still exists.
  slots.sort((a, b) => a.candidates.length - b.candidates.length
    || (services.find((service) => service.id === a.serviceId)!.display_order - services.find((service) => service.id === b.serviceId)!.display_order)
    || a.serviceId.localeCompare(b.serviceId) || a.index - b.index);
  const owners = new Map<string, number>();
  const chosen: string[] = Array(slots.length).fill("");
  function match(slotIndex: number, visited: Set<string>): boolean {
    const free = slots[slotIndex].candidates.find((id) => !visited.has(id) && !owners.has(id));
    if (free) {
      owners.set(free, slotIndex);
      chosen[slotIndex] = free;
      return true;
    }
    for (const personId of slots[slotIndex].candidates) {
      if (visited.has(personId)) continue;
      visited.add(personId);
      const owner = owners.get(personId);
      if (owner === undefined || match(owner, visited)) {
        owners.set(personId, slotIndex);
        chosen[slotIndex] = personId;
        return true;
      }
    }
    return false;
  }
  for (let index = 0; index < slots.length; index++) match(index, new Set());
  for (let index = 0; index < slots.length; index++) {
    const slot = slots[index];
    assignments[slot.serviceId][slot.index] = chosen[index];
  }
  // Reuse across services only after exhausting distinct-person matches; never within one service.
  const useCount = new Map<string, number>();
  for (const personId of chosen.filter(Boolean)) useCount.set(personId, (useCount.get(personId) ?? 0) + 1);
  for (const slot of slots) {
    if (assignments[slot.serviceId][slot.index]) continue;
    const candidates = slot.candidates.filter((id) => !assignments[slot.serviceId].includes(id));
    candidates.sort((a, b) => (useCount.get(a) ?? 0) - (useCount.get(b) ?? 0));
    const picked = candidates[0];
    if (picked) {
      assignments[slot.serviceId][slot.index] = picked;
      useCount.set(picked, (useCount.get(picked) ?? 0) + 1);
    }
  }
  return {
    assignments,
    unfilledServices: services.filter((service) => assignments[service.id].some((id) => !id)).map((service) => service.name),
    reusedPersonIds: [...useCount].filter(([, count]) => count > 1).map(([id]) => id),
  };
}
