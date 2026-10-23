export const APP_ROLES = ["ADMIN", "COORDINADOR", "COORDINADOR_LITURGIA", "LECTOR"] as const;
export type AppRole = typeof APP_ROLES[number];
export type AccessProfile = { role: string; active: boolean; parish_id: string | null };
export function canUseApp(profile?: AccessProfile | null): boolean {
  return !!profile?.active && !!profile.parish_id && APP_ROLES.some((role) => role === profile.role);
}
export function permissionsFor(role: string) {
  const known = APP_ROLES.some((value) => value === role);
  const admin = role === "ADMIN";
  const peopleEditor = admin || role === "COORDINADOR";
  const commissionEditor = peopleEditor || role === "COORDINADOR_LITURGIA";
  return { manageUsers: admin, manageConfiguration: admin, manageServices: admin, manageSchedules: admin, manageSettings: admin,
    viewCommissions: known, createCommission: commissionEditor, editCommissions: commissionEditor,
    assignServices: commissionEditor, autoAssign: commissionEditor, confirmCommission: commissionEditor,
    reopenCompleted: peopleEditor, viewPeople: known && role !== "COORDINADOR_LITURGIA", editPeople: peopleEditor };
}
export function canManageUsers(profile?: AccessProfile | null): boolean {
  return canUseApp(profile) && permissionsFor(profile!.role).manageUsers;
}
export function canViewCommission(role: string, status: string): boolean {
  return permissionsFor(role).viewCommissions && (role !== "LECTOR" || status === "published");
}
export function canAccessPath(role: string, path: string): boolean {
  const permission = permissionsFor(role);
  if (path.startsWith("/admin/") || path.startsWith("/api/admin/")) return permission.manageConfiguration;
  if (path.startsWith("/servidores") || path.startsWith("/api/servidores")) {
    if (!permission.viewPeople) return false;
    if (path.endsWith("/nuevo") || path.endsWith("/editar")) return permission.editPeople;
  }
  if (path.startsWith("/comisiones")) {
    if (!permission.viewCommissions) return false;
    if (path.endsWith("/nueva") || path.endsWith("/editar")) return permission.editCommissions;
  }
  return true;
}
