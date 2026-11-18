export const APP_ROLES = ["ADMIN", "TESORERO", "COORDINADOR", "COORDINADOR_LITURGIA", "LECTOR", "SERVIDOR"] as const;
export type AppRole = typeof APP_ROLES[number];
export const APP_PERMISSION_KEYS = [
  "portal.view", "commissions.view_own", "commissions.manage", "notices.view", "notices.manage",
  "attendance.view_own", "attendance.view_all", "attendance.manage", "treasury.view_own_contributions",
  "treasury.view", "treasury.manage", "treasury.export", "users.manage_permissions",
] as const;
export type AppPermission = (typeof APP_PERMISSION_KEYS)[number];
export const APP_PERMISSIONS: { key: AppPermission; label: string }[] = [
  { key: "portal.view", label: "Portal personal" },
  { key: "commissions.view_own", label: "Consultar comisiones propias" },
  { key: "commissions.manage", label: "Administrar comisiones" },
  { key: "notices.view", label: "Consultar avisos" },
  { key: "notices.manage", label: "Administrar avisos" },
  { key: "attendance.view_own", label: "Consultar asistencias propias" },
  { key: "attendance.view_all", label: "Consultar todas las asistencias" },
  { key: "attendance.manage", label: "Capturar asistencias" },
  { key: "treasury.view_own_contributions", label: "Consultar aportaciones propias" },
  { key: "treasury.view", label: "Consultar Tesorería" },
  { key: "treasury.manage", label: "Administrar Tesorería" },
  { key: "treasury.export", label: "Exportar Tesorería" },
  { key: "users.manage_permissions", label: "Administrar permisos de usuarios" },
];
export type AccessProfile = { role: string; active: boolean; parish_id: string | null };
export function canUseApp(profile?: AccessProfile | null): boolean {
  return !!profile?.active && !!profile.parish_id && APP_ROLES.some((role) => role === profile.role);
}
export function permissionsFor(role: string) {
  const known = APP_ROLES.some((value) => value === role);
  const admin = role === "ADMIN";
  const peopleEditor = admin || role === "COORDINADOR";
  const treasuryManager = admin || role === "TESORERO";
  const attendanceManager = admin || role === "COORDINADOR" || role === "COORDINADOR_LITURGIA";
  const commissionEditor = peopleEditor || role === "COORDINADOR_LITURGIA";
  return { manageUsers: admin, manageConfiguration: admin, manageServices: admin, manageSchedules: admin, manageSettings: admin,
    viewCommissions: known, createCommission: commissionEditor, editCommissions: commissionEditor,
    assignServices: commissionEditor, autoAssign: commissionEditor, confirmCommission: commissionEditor,
    reopenCompleted: peopleEditor, viewPeople: known && role !== "COORDINADOR_LITURGIA" && role !== "SERVIDOR", editPeople: peopleEditor,
    viewTreasury: treasuryManager, manageTreasury: treasuryManager,
    viewAttendance: known, manageAttendance: attendanceManager };
}
export function canManageUsers(profile?: AccessProfile | null): boolean {
  return canUseApp(profile) && permissionsFor(profile!.role).manageUsers;
}
export function canViewCommission(role: string, status: string): boolean {
  return permissionsFor(role).viewCommissions && (role !== "LECTOR" && role !== "SERVIDOR" || status === "published");
}
export function canAccessPath(role: string, path: string): boolean {
  const permission = permissionsFor(role);
  if (path === "/portal") return role === "ADMIN" || (permission.viewCommissions && role !== "SERVIDOR") || role === "SERVIDOR";
  if (path === "/admin/avisos") return role === "ADMIN" || role === "COORDINADOR" || role === "COORDINADOR_LITURGIA";
  if (path.startsWith("/admin/tesoreria")) return permission.viewTreasury;
  if (path.startsWith("/admin/") || path.startsWith("/api/admin/")) return permission.manageConfiguration;
  if (path.startsWith("/servidores") || path.startsWith("/api/servidores")) {
    if (!permission.viewPeople) return false;
    if (path.endsWith("/nuevo") || path.endsWith("/editar")) return permission.editPeople;
  }
  if (path.startsWith("/comisiones")) {
    if (!permission.viewCommissions) return false;
    if (path.endsWith("/nueva") || path.endsWith("/editar")) return permission.editCommissions;
  }
  if (path.startsWith("/tesoreria") || path.startsWith("/aportaciones")) {
    if (!permission.viewTreasury) return false;
  }
  if (path.startsWith("/asistencias")) {
    if (!permission.manageAttendance) return false;
  }
  return true;
}
