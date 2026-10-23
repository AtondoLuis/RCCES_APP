import { canViewCommission } from "./permissions";
export type PeopleStatusFilter = "active" | "inactive" | "all";
export function matchesPeopleFilter(person: { active: boolean; first_name: string; last_name: string; display_name?: string | null; email?: string | null }, search = "", state: PeopleStatusFilter = "active"): boolean {
  return (state === "all" || person.active === (state === "active"))
    && `${person.first_name} ${person.last_name} ${person.display_name ?? ""} ${person.email ?? ""}`.toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es"));
}
export function matchesCommissionFilter(mass: { status: string }, role: string, state = "active"): boolean {
  if (!canViewCommission(role, mass.status)) return false;
  if (state === "all") return true;
  if (state === "active") return mass.status === "draft" || mass.status === "published";
  return mass.status === state;
}
