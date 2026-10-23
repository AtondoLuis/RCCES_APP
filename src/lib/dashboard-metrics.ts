export type PersonStatusRow = { parish_id: string; active: boolean };

export function countPeopleByStatus(people: PersonStatusRow[], parishId: string) {
  return people.reduce((counts, person) => {
    if (person.parish_id !== parishId) return counts;
    if (person.active) counts.active += 1;
    else counts.inactive += 1;
    return counts;
  }, { active: 0, inactive: 0 });
}
