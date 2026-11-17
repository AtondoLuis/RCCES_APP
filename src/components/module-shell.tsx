"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Shell } from "@/components/dashboard";
import { createClient } from "@/lib/supabase/client";
import type { AppRole } from "@/lib/permissions";

export function ModuleShell({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [role, setRole] = useState<AppRole>("LECTOR");
  const [patronUrl, setPatronUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) { queueMicrotask(() => setLoading(false)); return; }
    void supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) { router.replace("/login"); return; }
      const profile = await supabase.from("profiles").select("role,parish_id").eq("id", data.user.id).maybeSingle();
      if (profile.data?.role) setRole(profile.data.role as AppRole);
      if (profile.data?.parish_id) {
        const parish = await supabase.from("parishes").select("patron_image_url").eq("id", profile.data.parish_id).maybeSingle();
        setPatronUrl(parish.data?.patron_image_url ?? null);
      }
      setLoading(false);
    });
  }, [router, supabase]);

  if (loading) return <Shell role={role}><div className="card-panel p-6">Cargando...</div></Shell>;
  return <Shell role={role} patronImageUrl={patronUrl} onLogout={async () => {
    await supabase?.auth.signOut();
    router.push("/login");
  }}>{children}</Shell>;
}
