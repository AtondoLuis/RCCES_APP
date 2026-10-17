export const APP_ROLES = ["ADMIN", "COORDINADOR", "LECTOR"] as const;
export type AppRole = typeof APP_ROLES[number];
export type AccessProfile = { role: string; active: boolean; parish_id: string | null };
export function canUseApp(profile?: AccessProfile | null): boolean {
  return !!profile?.active && !!profile.parish_id && APP_ROLES.some((role) => role === profile.role);
}
export function permissionsFor(role: string) {
  return { manageUsers: role === "ADMIN", manageConfiguration: role === "ADMIN",
    editCommissions: role === "ADMIN" || role === "COORDINADOR",
    editPeople: role === "ADMIN" || role === "COORDINADOR" };
}
export function canManageUsers(profile?: AccessProfile | null): boolean {
  return canUseApp(profile) && permissionsFor(profile!.role).manageUsers;
}
