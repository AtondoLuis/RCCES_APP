import { generateMassServiceAssignments } from "./auto-assign";
import { generateCleaningAssignments, type CleaningAssignInput } from "./cleaning-assign";
import { isMassService } from "./service-rules";

export function generateCommissionAssignments(input: CleaningAssignInput, categoryId?: string) {
  const services = categoryId
    ? input.services.filter((service) => service.category_id === categoryId)
    : input.services;
  const targetIds = new Set(services.map((service) => service.id));
  const reservedAssignments = categoryId
    ? Object.fromEntries(Object.entries(input.existingAssignments).filter(([id]) => !targetIds.has(id) && input.services.some((service) => service.id === id && isMassService(service))))
    : undefined;
  const scoped: CleaningAssignInput = {
    ...input,
    services,
    history: categoryId ? input.history.filter((row) => !input.services.some((service) => service.id === row.service_id && !isMassService(service))) : input.history,
    reservedAssignments,
  };
  const mass = generateMassServiceAssignments(scoped);
  const cleaning = generateCleaningAssignments(scoped);
  return {
    assignments: categoryId
      ? { ...input.existingAssignments, ...mass.assignments, ...cleaning.assignments }
      : { ...mass.assignments, ...cleaning.assignments },
    mass,
    cleaning,
    services,
  };
}
