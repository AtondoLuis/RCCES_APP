import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssignmentAvailability, AssignmentHistory, AssignmentMass, AssignmentPerson, AssignmentService } from "./auto-assign";

import type { CleaningHistory } from "./cleaning-assign";

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

async function readPages<T>(read: (from: number, to: number) => PromiseLike<PageResult<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await read(from, from + 499);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 500) return rows;
  }
}

type PersonRow = Omit<AssignmentPerson, "services"> & { person_services: { service_id: string }[] };
type MassRow = Omit<AssignmentMass, "time"> & { mass_times: { time: string } | null };

export async function loadAutoAssignData(client: SupabaseClient, parishId: string, date: string, signal: AbortSignal) {
  const [people, services, masses, history, availability, cleaningHistory] = await Promise.all([
    readPages((from, to) => client.from("people")
      .select("id,parish_id,active,person_services(service_id)").eq("parish_id", parishId)
      .order("id").range(from, to).abortSignal(signal).returns<PersonRow[]>()),
    // Services are a shared catalog in the current schema, not parish-owned rows.
    readPages((from, to) => client.from("services")
      .select("id,name,stable_key,slug,active,display_order,allow_multiple_people,required_servers")
      .order("id").range(from, to).abortSignal(signal).returns<AssignmentService[]>()),
    readPages((from, to) => client.from("masses")
      .select("id,parish_id,mass_date,mass_time_id,status,mass_times(time)")
      .eq("parish_id", parishId).lte("mass_date", date).neq("status", "cancelled")
      .order("id").range(from, to).abortSignal(signal).returns<MassRow[]>()),
    readPages((from, to) => client.from("mass_assignments")
      .select("mass_id,person_id,service_id,masses!inner(parish_id,mass_date,status)")
      .eq("masses.parish_id", parishId).lte("masses.mass_date", date).neq("masses.status", "cancelled")
      .order("id").range(from, to).abortSignal(signal).returns<AssignmentHistory[]>()),
    readPages((from, to) => client.from("person_availability")
      .select("person_id,mass_date,mass_time_id,status,people!inner(parish_id)")
      .eq("people.parish_id", parishId).eq("mass_date", date)
      .order("id").range(from, to).abortSignal(signal).returns<AssignmentAvailability[]>()),
    readPages((from, to) => client.from("cleaning_assignments")
      .select("mass_id,person_id,service_id,masses!inner(parish_id,mass_date,status)")
      .eq("parish_id", parishId).eq("masses.parish_id", parishId)
      .lte("masses.mass_date", date).neq("masses.status", "cancelled")
      .order("id").range(from, to).abortSignal(signal).returns<CleaningHistory[]>()),
  ]);
  return {
    people: people.map(({ person_services, ...person }) => ({ ...person, services: person_services.map((row) => row.service_id) })),
    services,
    masses: masses.map(({ mass_times, ...mass }) => ({ ...mass, time: mass_times?.time ?? "23:59:59" })),
    history,
    cleaningHistory,
    availability,
  };
}
