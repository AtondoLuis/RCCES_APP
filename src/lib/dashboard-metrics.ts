export type PersonStatusRow = { parish_id: string; active: boolean };

export function countPeopleByStatus(people: PersonStatusRow[], parishId: string) {
  return people.reduce((counts, person) => {
    if (person.parish_id !== parishId) return counts;
    if (person.active) counts.active += 1;
    else counts.inactive += 1;
    return counts;
  }, { active: 0, inactive: 0 });
}

export type ClassCountRow = PersonStatusRow & { class_id?: string | null };

export function countPeopleSummary(people: ClassCountRow[], parishId: string, classId: string) {
  return people.reduce((counts, person) => {
    if (person.parish_id !== parishId) return counts;
    if (!person.active) { counts.inactive += 1; return counts; }
    counts.active += 1;
    if (classId === "all" || (classId === "unassigned" ? !person.class_id : person.class_id === classId)) counts.inClassActive += 1;
    return counts;
  }, { active: 0, inactive: 0, inClassActive: 0 });
}
