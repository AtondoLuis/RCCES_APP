"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { WandSparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { type AssignmentMap, type AssignmentPerson, type AssignmentService } from "@/lib/auto-assign";
import { generateCommissionAssignments } from "@/lib/assignment-generation";
import { loadAutoAssignData } from "@/lib/auto-assign-data";

import { getRequiredAssignmentCount, isMassService } from "@/lib/service-rules";

type Props = {
  parishId: string;
  massId?: string;
  date: string;
  massTimeId: string;
  time: string;
  assignments: AssignmentMap;
  people: Array<Pick<AssignmentPerson, "id" | "active" | "services">>;
  services: AssignmentService[];
  categories: Array<{ id: string; name: string }>;
  allowMultipleServices: boolean;
  onGenerated: (assignments: AssignmentMap) => void;
};

export function AutoAssignmentControls(props: Props) {
  const client = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [warning, setWarning] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, [props.assignments]);

  async function generate(categoryId?: string) {
    if (busy || request.current || !client || !props.date || !props.time || !props.massTimeId) return;
    const targetIds = new Set(props.services.filter((service) => !categoryId || service.category_id === categoryId).map((service) => service.id));
    if ((!categoryId ? Object.values(props.assignments).some((ids) => ids.some(Boolean)) : Object.entries(props.assignments).some(([id, ids]) => targetIds.has(id) && ids.some(Boolean)))
      && !window.confirm("Esto reemplazará las asignaciones actuales. ¿Continuar?")) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setWarning("");
    setMessage("Generando asignaciones...");
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const data = await loadAutoAssignData(client, props.parishId, props.date, controller.signal);
      if (controller.signal.aborted) return;
      const visiblePeople = new Map(props.people.map((person) => [person.id, person]));
      const visibleServices = new Set(props.services.map((service) => service.id));
      const input = {
        ...data,
        // A newly-authorized person must also be present in the editable selects.
        people: data.people.filter((person) => visiblePeople.get(person.id)?.active).map((person) => ({
          ...person, services: person.services.filter((id) => visiblePeople.get(person.id)!.services.includes(id)),
        })),
        services: data.services.filter((service) => visibleServices.has(service.id)),
        parishId: props.parishId, date: props.date, massTimeId: props.massTimeId,
        time: props.time, massId: props.massId, existingAssignments: props.assignments,
        allowMultipleServices: props.allowMultipleServices,
      };
      const { assignments, mass: result, cleaning, services } = generateCommissionAssignments(input, categoryId);
      props.onGenerated(assignments);
      setMessage("Asignaciones generadas. Puedes modificarlas antes de guardar.");
      setWarning([
        ...services.filter((service) => service.active && isMassService(service)).map((service) => {
          const missing = getRequiredAssignmentCount(service, props.assignments[service.id]?.length) - (result.assignments[service.id] ?? []).filter(Boolean).length;
          return missing > 0 ? `Faltan ${missing} servidores para completar ${service.name}.` : "";
        }),
        cleaning.missingCount ? `Faltan ${cleaning.missingCount} personas para Limpieza.` : "",
        result.reusedPersonIds.length ? "Fue necesario reutilizar servidores por falta de candidatos suficientes." : "",
      ].filter(Boolean).join(" "));
    } catch {
      setMessage(controller.signal.aborted ? "Asignación cancelada. Puedes intentarlo de nuevo."
        : "No se pudieron generar las asignaciones. Intenta de nuevo.");
    } finally {
      window.clearTimeout(timeout);
      if (controller.signal.aborted) setMessage("Asignación cancelada. Puedes intentarlo de nuevo.");
      if (request.current === controller) request.current = null;
      setBusy(false);
    }
  }

  return <div className="my-4 space-y-2">
    <button type="button" onClick={() => void generate()} disabled={busy || !client || !props.date || !props.time}
      className="primary w-full text-sm sm:w-auto" aria-busy={busy}>
      <WandSparkles size={17}/> Asignar automáticamente
    </button>
    <div className="flex flex-wrap gap-2">{(props.categories ?? []).filter((category) => props.services.some((service) => service.active && service.category_id === category.id)).map((category) => <button key={category.id} type="button" onClick={() => void generate(category.id)} disabled={busy || !client || !props.date || !props.time} className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold" aria-label={`Asignar sección: ${category.name}`}>Asignar sección: {category.name}</button>)}</div>
    <p role="status" aria-live="polite" className="text-sm text-slate-600">{message}</p>
    {warning && <p role="status" className="text-sm text-amber-800">{warning}</p>}
  </div>;
}
