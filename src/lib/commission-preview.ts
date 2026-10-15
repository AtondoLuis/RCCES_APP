import type { AssignmentMap } from "@/lib/auto-assign";

export function repeatedPersonIds(assignments: AssignmentMap): Set<string> {
  const counts = new Map<string, number>();
  for (const personId of Object.values(assignments).flat()) {
    if (personId) counts.set(personId, (counts.get(personId) ?? 0) + 1);
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
