import { isMassService, type RuleService } from "./service-rules";
import type { AssignmentMap } from "@/lib/auto-assign";

export function repeatedPersonIds(assignments: AssignmentMap, services: RuleService[] = []): Set<string> {
  const counts = new Map<string, number>();
  for (const [id, ids] of Object.entries(assignments)) {
    if (services.some((s) => s.id === id && !isMassService(s))) continue;
    for (const personId of new Set(ids)) {
      if (personId) counts.set(personId, (counts.get(personId) ?? 0) + 1);
    }
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([personId]) => personId));
}

export function previewAssignmentNames(
  personIds: string[],
  personName: (personId: string) => string,
  repeatedIds: Set<string>,
): string {
  const names = personIds.filter(Boolean).map((personId) => {
    const marker = repeatedIds.has(personId) ? " *" : "";
    return `${personName(personId)}${marker}`;
  });
  return names.join(" · ") || "Pendiente";
}
