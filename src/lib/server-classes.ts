export const SERVER_CLASSES = [
  { id: "crecimiento-jovenes-1", label: "Crecimiento Jóvenes 1" },
  { id: "crecimiento-jovenes-2", label: "Crecimiento Jóvenes 2" },
  { id: "crecimiento-5", label: "Crecimiento 5" },
  { id: "crecimiento-4", label: "Crecimiento 4" },
] as const;

export type ServerClassId = (typeof SERVER_CLASSES)[number]["id"];
export type ServerClassFilter = ServerClassId | "all" | "unassigned";

export function serverClassLabel(id: ServerClassId | null | undefined): string {
  return SERVER_CLASSES.find((item) => item.id === id)?.label ?? "Sin asignar";
}
