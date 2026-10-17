export const COMMISSION_STATUSES = {
  draft: "Borrador", published: "Confirmada", finished: "Realizada", cancelled: "Cancelada",
} as const;
export function statusLabel(status?: string | null): string {
  return COMMISSION_STATUSES[status as keyof typeof COMMISSION_STATUSES] ?? "Borrador";
}
// Unknown legacy states are not evidence that somebody actually served.
export function countsForRotation(status?: string | null): boolean {
  return status === "published" || status === "finished";
}
export function statusTransitions(status: string): string[] {
  return ({ draft: ["published"], published: ["finished", "draft", "cancelled"], finished: ["draft"], cancelled: ["draft"] } as Record<string, string[]>)[status] ?? ["draft"];
}
