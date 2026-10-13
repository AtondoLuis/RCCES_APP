import { Suspense } from "react";
import Dashboard from "@/components/dashboard";
export default function Page() { return <Suspense fallback={<div>Cargando...</div>}><Dashboard /></Suspense>; }
