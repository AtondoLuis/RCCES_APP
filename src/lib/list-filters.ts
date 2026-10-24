import { type ServerClassFilter, type ServerClassId } from "./server-classes";
import { canViewCommission } from "./permissions";
export type PeopleStatusFilter = "active" | "inactive" | "all";
export function matchesPeopleFilter(person: { active: boolean; first_name: string; last_name: string; display_name?: string | null; email?: string | null; class_id?: ServerClassId | null }, search = "", state: PeopleStatusFilter = "active", classFilter: ServerClassFilter = "all"): boolean {
  return (state === "all" || person.active === (state === "active"))
    && (classFilter === "all" || (classFilter === "unassigned" ? !person.class_id : person.class_id === classFilter))
    && `${person.first_name} ${person.last_name} ${person.display_name ?? ""} ${person.email ?? ""}`.toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es"));
}
export function matchesCommissionFilter(mass: { status: string }, role: string, state = "active"): boolean {
  if (!canViewCommission(role, mass.status)) return false;
  if (state === "all") return true;
  if (state === "active") return mass.status === "draft" || mass.status === "published";
  return mass.status === state;
}
