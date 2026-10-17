import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AccessError, requireAdmin } from "@/lib/admin-access";
import UsersAdmin from "@/components/users-admin";
async function AdminGate() {
  try { await requireAdmin(); }
  catch (error) {
    if (error instanceof AccessError && error.status === 401) redirect("/login");
    if (error instanceof AccessError && error.status === 403) return <p role="alert">Acceso denegado. Solo ADMIN puede administrar usuarios.</p>;
    throw error;
  }
  return <UsersAdmin />;
}
export default function Page() { return <Suspense fallback={<p>Cargando usuarios...</p>}><AdminGate /></Suspense>; }
